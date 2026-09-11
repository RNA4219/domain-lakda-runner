"""実機観測を、一回限りの接続と要求へ束縛するHTTP用state。"""
from datetime import datetime, timezone
import hashlib
import json
import re
import threading
import time
import native_identity_clock as clock
import uuid
from native_identity import SOURCES, PACKAGE, _text, _private_adb_logging
from native_identity_actions import NativeIdentityActions
from native_identity_capture_exchange import NativeIdentityCaptures
from native_identity_transport import NativeAndroidTransport, NativeTransportError

SESSION_MS = 30_000
MAX_SESSIONS = 32
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}")


class NativeIdentityExchangeError(ValueError):
    def __init__(self, code, status=409):
        super().__init__("native-identity: " + code)
        self.code, self.status = "native-identity: " + code, status


def _keys(value, names):
    if not isinstance(value, dict) or set(value) != set(names):
        raise NativeIdentityExchangeError("request-invalid", 400)


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _digest(value):
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return "sha256:" + hashlib.sha256(raw).hexdigest()


def _iso(milliseconds):
    return datetime.fromtimestamp(milliseconds / 1000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _same_marker(first, second):
    return all(first[index] is second[index] for index in range(3)) and first[3] == second[3]


def _declarations(state):
    value = {"appId": state.app_id, "appRevision": state.app_revision,
             "deviceDigest": state.serial_digest, "platformVersion": state.platform_version}
    if any(item is not None and not _text(item) for item in value.values()) or not _matches(PACKAGE, value["appId"]):
        raise NativeIdentityExchangeError("declaration-invalid", 412)
    if value["deviceDigest"] is not None and not _matches(DIGEST, value["deviceDigest"]):
        raise NativeIdentityExchangeError("declaration-invalid", 412)
    return value


def _public_fields(snapshot, declared):
    _keys(snapshot, ("provider", "fields"))
    _keys(snapshot["provider"], ("name", "version"))
    identifier = re.compile(r"[A-Za-z0-9][A-Za-z0-9._/+:-]{0,95}")
    if not all(_matches(identifier, item) for item in snapshot["provider"].values()):
        raise NativeIdentityExchangeError("provider-invalid", 412)
    _keys(snapshot["fields"], SOURCES)
    fields = {}
    for key, field in snapshot["fields"].items():
        _keys(field, ("status", "source", "value"))
        declaration = declared["appRevision" if key == "appBuild" else key]
        if field["status"] == "observed":
            valid = field["source"] == SOURCES[key] and _text(field["value"])
            if key == "deviceDigest":
                valid = valid and _matches(DIGEST, field["value"])
            if key == "appBuild":
                valid = valid and _matches(re.compile(r"0|[1-9][0-9]{0,19}"), field["value"])
            if key == "appId":
                valid = valid and _matches(PACKAGE, field["value"])
            if not valid:
                raise NativeIdentityExchangeError("provider-invalid", 412)
            fields[key] = dict(field)
        else:
            unavailable = field == {"status": "unavailable", "source": "unavailable", "value": None}
            declared_only = declaration is not None and field == {"status": "declared-only", "source": "operator-declaration", "value": None}
            if not unavailable and not declared_only:
                raise NativeIdentityExchangeError("provider-invalid", 412)
            fields[key] = {"status": "declared-only" if declaration is not None else "unavailable",
                           "source": "operator-declaration" if declaration is not None else "unavailable", "value": None}
    return dict(snapshot["provider"]), fields


class NativeIdentityExchange:
    def __init__(self, state):
        self.state = state
        self._sessions = {}
        self._lock = threading.Lock()
        self._transport_lock = threading.Lock()
        self._transport, self._transport_marker = None, None
        self._transport_factory = NativeAndroidTransport
        self._closed = False
        self._closing = False
        self.actions = NativeIdentityActions(self, NativeIdentityExchangeError)
        self.captures = NativeIdentityCaptures(self.actions)

    def close(self):
        self._closing = True
        stop_captures = getattr(self.state, "close_native_captures", None)
        if callable(stop_captures) and not stop_captures(500):
            raise NativeIdentityExchangeError("capture-close-unconfirmed", 412)
        if not self._transport_lock.acquire(timeout=0.5):
            raise NativeIdentityExchangeError("transport-close-unconfirmed", 412)
        try:
            self._closed = True
            if self._transport is not None:
                self._transport.close()
        finally:
            self._transport_lock.release()

    def _check_open(self):
        if self._closed or self._closing:
            raise NativeIdentityExchangeError("transport-closed" if self._closed else "bridge-closing", 412)

    def _check_transport(self, transport, marker):
        try:
            if self._closed:
                raise NativeTransportError("transport-closed")
            transport.check(marker[2])
        except NativeTransportError as error:
            raise NativeIdentityExchangeError(error.code, 412) from None
        except Exception:
            raise NativeIdentityExchangeError("transport-unavailable", 412) from None

    def _capture_transport(self, marker, max_age_ms):
        if not self._transport_lock.acquire(timeout=0.5):
            raise NativeIdentityExchangeError("transport-busy", 429)
        try:
            self._check_open()
            if self._transport is not None and (self._transport.closed or not _same_marker(marker, self._transport_marker)):
                self._transport.close()
                self._transport = None
            duration = (SESSION_MS + max_age_ms) / 1000
            if self._transport is None:
                self._transport = self._transport_factory(marker[2], idle_timeout=duration)
                self._transport_marker = marker
            self._check_transport(self._transport, marker)
            self._transport.keepalive(time.monotonic() + duration)
            return self._transport
        except NativeTransportError as error:
            raise NativeIdentityExchangeError(error.code, 412) from None
        finally:
            self._transport_lock.release()

    def _check_capacity(self):
        now = time.monotonic()
        self._sessions = {key: value for key, value in self._sessions.items() if value["deadline"] > now}
        if len(self._sessions) >= MAX_SESSIONS:
            raise NativeIdentityExchangeError("session-capacity", 429)
        return now

    def _marker(self):
        device, runtime = self.state.device, self.state.airtest
        adb = getattr(device, "adb", None)
        selector = getattr(adb, "serialno", None)
        if self.state.platform != "android" or device is None or runtime is None or not _text(selector, 512):
            raise NativeIdentityExchangeError("provider-unavailable", 412)
        return (device, runtime, adb, selector)

    def _binding(self, endpoint):
        with _private_adb_logging():
            capability = self.state.capabilities()
        return {"capabilityDigest": _digest(capability), "bridgeDigest": _digest({"transport": "loopback-json/v1", "endpoint": endpoint})}

    def check_action_connection(self, marker, record, endpoint, transport):
        self._check_open()
        binding = {key: record["bridgeBinding"][key] for key in ("bridgeDigest", "capabilityDigest")}
        if not _same_marker(marker, self._marker()) or binding != self._binding(endpoint) or record["declared"] != _declarations(self.state) or not _same_marker(marker, self._marker()):
            raise NativeIdentityExchangeError("lease-connection-mismatch")
        self._check_transport(transport, marker)

    def open(self, request, endpoint):
        self._check_open()
        _keys(request, ("schemaVersion", "challenge", "bridgeBinding", "maxAgeMs"))
        _keys(request["bridgeBinding"], ("bridgeDigest", "capabilityDigest"))
        if request["schemaVersion"] != "lakda/native-identity-open/v1" or not _matches(UUID, request["challenge"]):
            raise NativeIdentityExchangeError("request-invalid", 400)
        if type(request["maxAgeMs"]) is not int or not 1000 <= request["maxAgeMs"] <= 300000 or not all(_matches(DIGEST, item) for item in request["bridgeBinding"].values()):
            raise NativeIdentityExchangeError("request-invalid", 400)
        marker, binding = self._marker(), self._binding(endpoint)
        if binding != request["bridgeBinding"] or not _same_marker(marker, self._marker()):
            raise NativeIdentityExchangeError("binding-mismatch")
        with self._lock:
            self._check_capacity()
        transport = self._capture_transport(marker, request["maxAgeMs"])
        if not _same_marker(marker, self._marker()):
            raise NativeIdentityExchangeError("binding-mismatch")
        with self._lock:
            now = self._check_capacity()
            connection_id, issued = str(uuid.uuid4()), clock.wall_milliseconds()
            self._sessions[connection_id] = {"deadline": now + SESSION_MS / 1000, "marker": marker,
                "binding": binding, "challenge": request["challenge"], "maxAgeMs": request["maxAgeMs"], "transport": transport}
        return {"schemaVersion": "lakda/native-identity-session/v1", "connectionId": connection_id,
                "challenge": request["challenge"], "platform": self.state.platform, "bridgeBinding": dict(binding),
                "issuedAt": _iso(issued), "expiresAt": _iso(issued + SESSION_MS)}

    def observe(self, request, endpoint):
        self._check_open()
        _keys(request, ("schemaVersion", "connectionId", "challenge"))
        if request["schemaVersion"] != "lakda/native-identity-request/v1" or not _matches(UUID, request["connectionId"]) or not _matches(UUID, request["challenge"]):
            raise NativeIdentityExchangeError("request-invalid", 400)
        with self._lock:
            session = self._sessions.pop(request["connectionId"], None)
        if session is None or session["deadline"] <= time.monotonic() or session["challenge"] != request["challenge"]:
            raise NativeIdentityExchangeError("session-unavailable")
        if not _same_marker(session["marker"], self._marker()) or session["binding"] != self._binding(endpoint) or not _same_marker(session["marker"], self._marker()):
            raise NativeIdentityExchangeError("binding-mismatch")
        declared = _declarations(self.state)
        self._check_transport(session["transport"], session["marker"])
        observed, started = clock.wall_milliseconds(), time.monotonic()
        try:
            snapshot = self.state.native_identity_fields(timeout_ms=min(5000, session["maxAgeMs"]))
        except Exception:
            raise NativeIdentityExchangeError("provider-unavailable", 412) from None
        if not _same_marker(session["marker"], self._marker()) or session["binding"] != self._binding(endpoint) or declared != _declarations(self.state) or not _same_marker(session["marker"], self._marker()):
            raise NativeIdentityExchangeError("binding-mismatch")
        self._check_transport(session["transport"], session["marker"])
        if time.monotonic() - started >= session["maxAgeMs"] / 1000 or not observed <= clock.wall_milliseconds() < observed + session["maxAgeMs"]:
            raise NativeIdentityExchangeError("observation-expired")
        provider, fields = _public_fields(snapshot, declared)
        record = {"schemaVersion": "lakda/native-identity-observation/v1", "observationId": str(uuid.uuid4()),
                  "challenge": request["challenge"], "platform": self.state.platform,
                  "bridgeBinding": {**session["binding"], "connectionId": request["connectionId"]},
                  "provider": provider, "fields": fields, "declared": declared,
                  "observedAt": _iso(observed), "expiresAt": _iso(observed + session["maxAgeMs"])}
        if len(json.dumps(record, ensure_ascii=False).encode("utf-8")) > 16_384:
            raise NativeIdentityExchangeError("observation-invalid", 412)
        self.actions.register(record, session["marker"], started + session["maxAgeMs"] / 1000, session["transport"])
        return record
