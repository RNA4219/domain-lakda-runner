"""接続済みSDKから取得する識別情報。宣言値やraw device情報を返さない。"""
from contextlib import contextmanager
import hashlib
import json
import logging
import re
import threading
import time

PROVIDER = {"name": "lakda-airtest-android", "version": "1.0.0-airtest-1.3.5"}
SOURCES = {"appId": "android-package-manager", "appBuild": "android-version-code",
           "deviceDigest": "android-serialno", "platformVersion": "android-release"}
MAX_RESPONSE_BYTES = 1_048_576
PACKAGE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*", re.ASCII)


def _unavailable():
    return {"provider": dict(PROVIDER), "fields": {
        key: {"status": "unavailable", "source": "unavailable", "value": None}
        for key in SOURCES}}


def _text(value, limit=256):
    if not isinstance(value, str) or not value or value.strip() != value:
        return False
    try:
        return len(value.encode("utf-16-le")) // 2 <= limit and not any(
            ord(character) < 32 or ord(character) == 127 or character in "/\\" for character in value)
    except UnicodeEncodeError:
        return False


def _property(value):
    # ADB's one terminal newline is framing; whitespace inside the value is data.
    return value[:-2] if value.endswith("\r\n") else value[:-1] if value.endswith("\n") else value


def _package(value, app_id):
    headers = list(re.finditer(r"^([ \t]*)Package \[([^\]\r\n]+)\] \([^\r\n)]*\):[ \t]*\r?$", value, re.MULTILINE))
    if len(headers) != 1 or headers[0][2] != app_id:
        return None
    header, body = headers[0], []
    for line in value[header.end():].splitlines():
        if not line.strip():
            continue
        if len(line) - len(line.lstrip(" \t")) <= len(header[1]):
            break
        body.append(line)
    versions = re.findall(r"^[ \t]+versionCode=(0|[1-9][0-9]{0,19})(?=[ \t\r\n]|$)", "\n".join(body), re.MULTILINE)
    return (app_id, versions[0]) if len(versions) == 1 else None


def android_device_digest(identifier):
    if not _text(identifier, 512):
        raise ValueError("native-identity: device-identifier-invalid")
    payload = {"schemaVersion": "lakda/native-device-digest/v1", "platform": "android",
               "source": SOURCES["deviceDigest"], "identifier": identifier}
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


@contextmanager
def _private_adb_logging():
    logger = logging.getLogger("airtest.core.android.adb")
    caller = threading.get_ident()

    class OtherThreads(logging.Filter):
        def filter(self, record):
            return record.thread != caller

    suppression = OtherThreads()
    logger.addFilter(suppression)
    try:
        yield
    finally:
        logger.removeFilter(suppression)


def observe_android_identity(device, app_id, runtime_versions, timeout_ms=5000):
    """固定のread-only queryでinstalled appと端末を観測する。実行許可は生成しない。"""
    if not isinstance(app_id, str) or len(app_id) > 256 or not PACKAGE.fullmatch(app_id) or type(timeout_ms) is not int or not 1000 <= timeout_ms <= 15000:
        raise ValueError("native-identity: identity-request-invalid")
    result = _unavailable()
    if not isinstance(runtime_versions, dict) or runtime_versions.get("airtestVersion") != "1.3.5":
        return result
    deadline = time.monotonic() + timeout_ms / 1000
    try:
        adb = getattr(device, "adb", None)
        selector = getattr(adb, "serialno", None)
        if not _text(selector, 512) or not callable(getattr(adb, "cmd", None)):
            return result

        def query(command):
            remaining = deadline - time.monotonic()
            if remaining <= 0 or device.adb is not adb or adb.serialno != selector:
                raise ValueError("native-identity: observation-unavailable")
            response = adb.cmd(command, device=True, ensure_unicode=False, timeout=remaining)
            if time.monotonic() >= deadline or device.adb is not adb or adb.serialno != selector:
                raise ValueError("native-identity: observation-unavailable")
            if not isinstance(response, bytes) or len(response) > MAX_RESPONSE_BYTES:
                raise ValueError("native-identity: observation-unavailable")
            return response.decode("utf-8", errors="strict")

        with _private_adb_logging():
            serial = _property(query(["shell", "getprop", "ro.serialno"]))
            if not _text(serial, 512):
                return result
            package = _package(query(["shell", "dumpsys", "package", app_id]), app_id)
            release = _property(query(["shell", "getprop", "ro.build.version.release"]))
            package_after = _package(query(["shell", "dumpsys", "package", app_id]), app_id)
            serial_after = _property(query(["shell", "getprop", "ro.serialno"]))
            if serial != serial_after or package != package_after or time.monotonic() >= deadline:
                return result
        values = {"appId": package[0] if package else None, "appBuild": package[1] if package else None,
                  "deviceDigest": android_device_digest(serial), "platformVersion": release if _text(release) else None}
        for key, value in values.items():
            if value is not None:
                result["fields"][key] = {"status": "observed", "source": SOURCES[key], "value": value}
        return result
    except Exception:
        # SDK errors can contain command arguments, raw serial, and package dumps.
        return _unavailable()
