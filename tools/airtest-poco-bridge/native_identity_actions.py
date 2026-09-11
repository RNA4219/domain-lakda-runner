"""観測済み接続へnative操作を束縛する。operator署名は発行しない。"""
import copy
from datetime import datetime, timezone
import hashlib
import json
import re
import threading
import time
import native_identity_clock as clock
from native_identity import _private_adb_logging
from native_identity_capture import NativeCaptureGuard

MAX_LEASES = 32
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
UTC = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z")


def _digest(value):
    return "sha256:" + hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def _milliseconds(value):
    return _window_time(value)


def _iso(value):
    return datetime.fromtimestamp(value / 1000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _window_time(value):
    if not isinstance(value, str) or not UTC.fullmatch(value):
        raise ValueError()
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    delta = parsed - datetime(1970, 1, 1, tzinfo=timezone.utc)
    return (delta.days * 86400 + delta.seconds) * 1000 + delta.microseconds // 1000


class NativeIdentityActions:
    def __init__(self, exchange, error_type):
        self.exchange, self.error_type = exchange, error_type
        self._leases = {}
        self._lock = threading.Lock()
        self._operation = threading.Lock()

    def register(self, record, marker, deadline, transport):
        if any(record["fields"][field]["status"] != "observed" for field in ("appId", "appBuild", "deviceDigest")):
            return
        poco = self.exchange.state.poco
        with self._lock:
            self._leases = {key: value for key, value in self._leases.items() if value["deadline"] > time.monotonic()}
            if len(self._leases) >= MAX_LEASES:
                raise self.error_type("lease-capacity", 429)
            self._leases[record["observationId"]] = {
                "record": copy.deepcopy(record), "digest": _digest(record), "marker": marker, "deadline": deadline,
                "poco": poco, "agent": getattr(poco, "agent", None), "ordinal": 0, "transport": transport,
            }

    def _request(self, request):
        def keys(value, required):
            if not isinstance(value, dict) or set(value) != set(required):
                raise self.error_type("action-request-invalid", 400)
        version = request.get("schemaVersion") if isinstance(request, dict) else None
        windowed = version == "lakda/native-action-request/v2"
        keys(request, ("schemaVersion", "operation", "lease", "ordinal", "payload") + (("approvalWindow",) if windowed else ()))
        keys(request["lease"], ("observationId", "observationDigest", "connectionId", "challenge"))
        if version not in ("lakda/native-action-request/v1", "lakda/native-action-request/v2") or request["operation"] not in ("execute", "recover"):
            raise self.error_type("action-request-invalid", 400)
        if windowed:
            window = request["approvalWindow"]
            keys(window, ("targetManifestSha256", "validFrom", "validUntil"))
            try:
                if not isinstance(window["targetManifestSha256"], str) or not DIGEST.fullmatch(window["targetManifestSha256"]):
                    raise ValueError()
                if _window_time(window["validFrom"]) >= _window_time(window["validUntil"]):
                    raise ValueError()
            except Exception:
                raise self.error_type("action-request-invalid", 400) from None
        if type(request["ordinal"]) is not int or not 1 <= request["ordinal"] <= 2147483647:
            raise self.error_type("action-request-invalid", 400)
        for key, value in request["lease"].items():
            pattern = DIGEST if key == "observationDigest" else UUID
            if not isinstance(value, str) or not pattern.fullmatch(value):
                raise self.error_type("action-request-invalid", 400)
        keys(request["payload"], ("candidate" if request["operation"] == "execute" else "failure", "context"))
        if not all(isinstance(value, dict) for value in request["payload"].values()):
            raise self.error_type("action-request-invalid", 400)

    def _bind_window(self, entry, request):
        version, window = request["schemaVersion"], request.get("approvalWindow")
        if "protocol" in entry:
            if entry["protocol"] != version or entry["window"] != window:
                raise self.error_type("approval-window-mismatch")
            return
        entry["protocol"], entry["window"] = version, copy.deepcopy(window)
        if window is not None:
            mono, now = time.monotonic(), clock.wall_milliseconds()
            start, end = _window_time(window["validFrom"]), _window_time(window["validUntil"])
            if not start <= now < end:
                raise self.error_type("approval-window-expired")
            entry.update(approval_start=start, approval_end=end, approval_floor=now,
                         approval_deadline=min(entry["deadline"], mono + (end - now) / 1000))

    def capture_guard(self, lease, window, endpoint):
        """撮影は操作連番を消費せず、同じv2承認と観測へ束縛する。"""
        try:
            if not isinstance(lease, dict) or set(lease) != {"observationId", "observationDigest", "connectionId", "challenge"}:
                raise ValueError()
            if any(not isinstance(value, str) or not (DIGEST if key == "observationDigest" else UUID).fullmatch(value) for key, value in lease.items()):
                raise ValueError()
            if not isinstance(window, dict) or set(window) != {"targetManifestSha256", "validFrom", "validUntil"}:
                raise ValueError()
            if not isinstance(window["targetManifestSha256"], str) or not DIGEST.fullmatch(window["targetManifestSha256"]) or _window_time(window["validFrom"]) >= _window_time(window["validUntil"]):
                raise ValueError()
        except Exception:
            raise self.error_type("capture-authorization-invalid", 400) from None
        with self._lock:
            entry = self._leases.get(lease["observationId"])
            if entry is None:
                raise self.error_type("lease-unavailable")
            record = entry["record"]
            expected = {"observationId": record["observationId"], "observationDigest": entry["digest"],
                        "connectionId": record["bridgeBinding"]["connectionId"], "challenge": record["challenge"]}
            if expected != lease:
                raise self.error_type("lease-binding-mismatch")
            self._bind_window(entry, {"schemaVersion": "lakda/native-action-request/v2", "approvalWindow": window})
        guard = NativeCaptureGuard(NativeActionGuard(self, entry, endpoint))
        guard.check()
        return guard

    def perform(self, request, endpoint):
        self._request(request)
        if not self._operation.acquire(blocking=False):
            raise self.error_type("action-busy", 409)
        key = request["lease"]["observationId"]
        entry = None
        try:
            with self._lock:
                entry = self._leases.get(key)
                if entry is None:
                    raise self.error_type("lease-unavailable")
                record = entry["record"]
                expected = {"observationId": key, "observationDigest": entry["digest"],
                            "connectionId": record["bridgeBinding"]["connectionId"], "challenge": record["challenge"]}
                if expected != request["lease"]:
                    del self._leases[key]
                    raise self.error_type("lease-binding-mismatch")
                if request["ordinal"] != entry["ordinal"] + 1:
                    entry = None
                    raise self.error_type("action-ordinal-mismatch")
                self._bind_window(entry, request)
                entry["ordinal"] = request["ordinal"]
            guard = NativeActionGuard(self, entry, endpoint)
            guard.check()
            if request["operation"] == "execute":
                result = self.exchange.state.execute(request["payload"], identity_guard=guard)
                success = result["status"] == "executed"
            else:
                result = self.exchange.state.recover(request["payload"], identity_guard=guard)
                success = result["recovered"] is True
            if not success:
                with self._lock:
                    self._leases.pop(key, None)
            response = {"schemaVersion": request["schemaVersion"].replace("request", "result"), "operation": request["operation"],
                    "lease": dict(request["lease"]), "ordinal": request["ordinal"], "checkedAt": guard.checked_at,
                    "actionAttempted": guard.attempted, "result": result}
            if entry["window"] is not None:
                response["approvalWindow"] = copy.deepcopy(entry["window"])
            return response
        except Exception:
            if entry is not None:
                with self._lock:
                    self._leases.pop(key, None)
            raise
        finally:
            self._operation.release()


class NativeActionGuard:
    def __init__(self, actions, entry, endpoint):
        self.actions, self.entry, self.endpoint = actions, entry, endpoint
        self.attempted = False
        self.checked_at = None

    def check(self):
        state = self.actions.exchange.state
        record, marker = self.entry["record"], self.entry["marker"]
        error = self.actions.error_type
        try:
            with self.actions._lock:
                if self.actions._leases.get(record["observationId"]) is not self.entry:
                    raise error("lease-unavailable")
            self.actions.exchange.check_action_connection(marker, record, self.endpoint, self.entry["transport"])
            selected = getattr(state.airtest, "device", None)
            if not callable(selected) or selected() is not marker[0]:
                raise error("sdk-selection-mismatch", 412)
            if state.poco is not self.entry["poco"] or getattr(state.poco, "agent", None) is not self.entry["agent"]:
                raise error("poco-connection-mismatch")
            if state.poco is not None and (self.entry["agent"] is None or getattr(state.poco, "device", None) is not marker[0] or getattr(state.poco, "adb_client", None) is not marker[2]):
                raise error("poco-device-mismatch", 412)
            self.actions.exchange.check_action_connection(marker, record, self.endpoint, self.entry["transport"])
            now = clock.wall_milliseconds()
            if not _milliseconds(record["observedAt"]) <= now < _milliseconds(record["expiresAt"]) or time.monotonic() >= self.entry["deadline"]:
                raise error("lease-expired")
            if self.entry["window"] is not None:
                if not self.entry["approval_start"] <= now < self.entry["approval_end"] or now < self.entry["approval_floor"] or time.monotonic() >= self.entry["approval_deadline"]:
                    raise error("approval-window-expired")
                self.entry["approval_floor"] = now
            self.checked_at = _iso(now)
            with self.actions._lock:
                if self.actions._leases.get(record["observationId"]) is not self.entry:
                    raise error("lease-unavailable")
        except error:
            raise
        except Exception:
            raise error("lease-check-failed", 412) from None

    def _invoke(self, method, *args):
        if not callable(method):
            raise self.actions.error_type("sdk-operation-unavailable", 412)
        self.check()
        self.attempted = True
        with _private_adb_logging():
            result = method(*args)
        self.check()
        return result

    def touch(self, position):
        return self._invoke(getattr(self.entry["marker"][0], "touch", None), position)

    def back(self):
        device = self.entry["marker"][0]
        keyevent = getattr(device, "keyevent", None)
        return self._invoke(keyevent, "BACK") if callable(keyevent) else self._invoke(getattr(device, "back", None))

    def poco_click(self, name):
        self.check()
        poco, device = self.entry["poco"], self.entry["marker"][0]
        if poco is None or getattr(poco, "device", None) is not device or getattr(poco, "adb_client", None) is not device.adb:
            raise self.actions.error_type("poco-device-mismatch", 412)
        node = poco(name=name)
        return self._invoke(getattr(node, "click", None))
