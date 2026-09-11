"""観測ごとの撮影連番、直前応答、開始時guardを保持する。"""
import copy
import json
from native_identity_actions import _digest, _iso
from native_identity_capture_contract import validate_request
import native_identity_clock as clock

MAX_SESSIONS = 32
MAX_RESPONSE = 4 * 1024 * 1024


class NativeIdentityCaptures:
    def __init__(self, actions):
        self.actions, self.state, self.error_type = actions, actions.exchange.state, actions.error_type
        self._sessions = {}

    def fail(self, reason, status=409):
        raise self.error_type(reason, status)

    def perform(self, value, endpoint):
        validate_request(value, self.error_type)
        request = copy.deepcopy(value)
        if len(json.dumps(request, ensure_ascii=False).encode()) > 65536:
            self.fail("capture-request-invalid", 400)
        if not self.actions._operation.acquire(blocking=False):
            self.fail("capture-busy")
        try:
            return self._perform(request, endpoint)
        finally:
            self.actions._operation.release()

    def _perform(self, request, endpoint):
        key, ordinal = request["lease"]["observationId"], request["ordinal"]
        signature = _digest(request)
        session = self._sessions.get(key)
        if session is not None:
            if (session["lease"], session["window"], session["endpoint"]) != (request["lease"], request["approvalWindow"], endpoint):
                self.fail("capture-binding-mismatch")
            if ordinal == session["ordinal"] and signature == session["signature"]:
                return copy.deepcopy(session["response"])
        previous = session["ordinal"] if session else 0
        cleanup = request["operation"] in ("stop", "discard")
        if ordinal <= previous or (not cleanup and ordinal != previous + 1):
            self.fail("capture-ordinal-mismatch")
        operation, payload = request["operation"], request["payload"]
        scope = (payload["runId"], payload["stagingDir"], payload.get("mode"))
        if operation in ("screenshot", "start"):
            guard = self.actions.capture_guard(request["lease"], request["approvalWindow"], endpoint)
        else:
            active = session.get("active") if session else None
            if active is None or active["ordinal"] != request["captureOrdinal"]:
                self.fail("capture-unavailable")
            if active["scope"] != scope:
                self.fail("capture-binding-mismatch")
            guard = active["guard"]
        if session is None:
            with self.actions._lock:
                self._sessions = {k: v for k, v in self._sessions.items() if v.get("active") or k in self.actions._leases}
            if len(self._sessions) >= MAX_SESSIONS:
                self.fail("capture-capacity", 429)
            session = {"lease": request["lease"], "window": request["approvalWindow"], "endpoint": endpoint, "active": None}
            self._sessions[key] = session
        if operation == "start" and session["active"] is not None:
            self.fail("capture-already-active")
        session.update(ordinal=ordinal, signature=signature)
        result = {"accepted": False, "mode": payload.get("mode", "screenshot"), "artifactRefs": [], "reason": "native-capture-failed"}
        # Install a refusal before dispatch so an exception cannot cause duplicate SDK work.
        response = {"schemaVersion": "lakda/native-capture-result/v1", "operation": operation, "ordinal": ordinal,
                    "captureOrdinal": request["captureOrdinal"], "requestSha256": signature, "completedAt": _iso(clock.wall_milliseconds()), "result": result}
        session["response"] = response
        try:
            if operation == "screenshot":
                refs = self.state.capture_evidence({"request": {**payload, "kinds": ["screenshot"]}}, identity_guard=guard)
                result = {"accepted": True, "mode": "screenshot", "artifactRefs": refs}
            else:
                if operation == "start":
                    session["active"] = {"ordinal": ordinal, "scope": scope, "guard": guard}
                with self.state._recording_lock:
                    recording = self.state._recording.get(payload["runId"])
                result = self.state.capture_control({"request": {**payload, "action": operation}}, identity_guard=guard)
                if operation == "stop" and payload["mode"] == "sampled-frames/v1" and result.get("accepted") is True:
                    if recording is None or recording.get("identityGuard") is not guard or result.get("stopped") is not True:
                        raise RuntimeError()
                    result = {**result, "artifactRefs": copy.deepcopy(recording["artifacts"])}
        except Exception:
            result = {"accepted": False, "mode": payload.get("mode", "screenshot"), "artifactRefs": [],
                      "stopped": result.get("stopped") is True, "reason": "native-capture-failed"}
        finally:
            if operation != "screenshot":
                with self.state._recording_lock:
                    active = self.state._recording.get(payload["runId"])
                    if active is None or active.get("identityGuard") is not guard:
                        session["active"] = None
        if result.get("accepted") is not True:
            result["artifactRefs"] = []
            if operation == "start":
                result["stopped"] = session["active"] is None
        response.update(completedAt=_iso(clock.wall_milliseconds()), result=result)
        if len(json.dumps(response, ensure_ascii=False).encode()) > MAX_RESPONSE:
            response["result"] = {"accepted": False, "mode": result["mode"], "artifactRefs": [],
                                  "stopped": result.get("stopped") is True, "reason": "native-capture-response-too-large"}
        session["response"] = copy.deepcopy(response)
        return response
