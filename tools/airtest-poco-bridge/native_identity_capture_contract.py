"""native capture HTTP v1の入力検証。時間の有効性はguardに委ねる。"""
from native_identity_actions import UUID, DIGEST, _window_time


def validate_request(value, error_type):
    def invalid():
        raise error_type("capture-request-invalid", 400)

    def keys(item, required, optional=()):
        if not isinstance(item, dict) or not set(required) <= set(item) or set(item) - set(required) - set(optional):
            invalid()

    def integer(item, maximum=9007199254740991):
        return type(item) is int and 1 <= item <= maximum

    keys(value, ("schemaVersion", "operation", "lease", "approvalWindow", "ordinal", "captureOrdinal", "payload"))
    if value["schemaVersion"] != "lakda/native-capture-request/v1" or value["operation"] not in ("screenshot", "start", "stop", "discard"):
        invalid()
    if not integer(value["ordinal"], 2147483647) or not integer(value["captureOrdinal"], value["ordinal"]):
        invalid()
    if value["operation"] in ("screenshot", "start") and value["ordinal"] != value["captureOrdinal"]:
        invalid()
    keys(value["lease"], ("observationId", "observationDigest", "connectionId", "challenge"))
    for key, item in value["lease"].items():
        if not isinstance(item, str) or not (DIGEST if key == "observationDigest" else UUID).fullmatch(item):
            invalid()
    window = value["approvalWindow"]
    keys(window, ("targetManifestSha256", "validFrom", "validUntil"))
    try:
        if not isinstance(window["targetManifestSha256"], str) or not DIGEST.fullmatch(window["targetManifestSha256"]):
            invalid()
        if _window_time(window["validFrom"]) >= _window_time(window["validUntil"]):
            invalid()
    except Exception:
        invalid()
    payload = value["payload"]
    screenshot = value["operation"] == "screenshot"
    keys(payload, ("runId", "stagingDir") if screenshot else ("runId", "stagingDir", "mode"),
         () if screenshot else ("intervalMs", "maxFrames", "maxBytes", "stopTimeoutMs"))
    for key, maximum in (("runId", 256), ("stagingDir", 4096)):
        if not isinstance(payload[key], str) or not 1 <= len(payload[key]) <= maximum or "\x00" in payload[key]:
            invalid()
    if not screenshot:
        if payload["mode"] not in ("video", "sampled-frames/v1"):
            invalid()
        for key in ("intervalMs", "maxFrames", "maxBytes", "stopTimeoutMs"):
            if key in payload and not integer(payload[key], 300000 if key == "stopTimeoutMs" else 9007199254740991):
                invalid()
        required = ("intervalMs", "maxFrames", "maxBytes", "stopTimeoutMs") if value["operation"] == "start" else ("stopTimeoutMs",)
        if payload["mode"] == "sampled-frames/v1" and not set(required) <= set(payload):
            invalid()
