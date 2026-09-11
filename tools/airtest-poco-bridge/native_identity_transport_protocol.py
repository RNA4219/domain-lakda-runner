"""固定ADB host serviceの有界read-only通信。raw一覧は返却・記録しない。"""
import os
import re
import socket
import time

IO_TIMEOUT = 0.5
SERVER_ENV = ("ADB_SERVER_SOCKET", "ANDROID_ADB_SERVER_ADDRESS", "ANDROID_ADB_SERVER_PORT")


class NativeTransportError(ValueError):
    def __init__(self, code="transport-unavailable"):
        super().__init__(code)
        self.code = code


def descriptor(adb):
    try:
        host, port, selector = adb.host, adb.port, adb.serialno
        path, options = adb.adb_path, adb.cmd_options
        if host not in ("127.0.0.1", "localhost", "::1") or type(port) is not int or not 1 <= port <= 65535:
            raise ValueError()
        if not isinstance(selector, str) or not 1 <= len(selector) <= 512 or any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in selector):
            raise ValueError()
        if not isinstance(path, str) or not path or not isinstance(options, list) or any(key in os.environ for key in SERVER_ENV):
            raise ValueError()
        expected = [path] + (["-H", host] if host not in ("127.0.0.1", "localhost") else []) + (["-P", str(port)] if port != 5037 else [])
        if options != expected:
            raise ValueError()
        return host, port, selector, path, tuple(options)
    except Exception:
        raise NativeTransportError("transport-config-invalid") from None


def remaining(deadline):
    value = deadline - time.monotonic()
    if value <= 0:
        raise NativeTransportError("transport-timeout")
    return value


def read_exact(connection, length, deadline):
    value = bytearray()
    while len(value) < length:
        connection.settimeout(remaining(deadline))
        chunk = connection.recv(length - len(value))
        if not chunk:
            raise NativeTransportError("transport-closed")
        value.extend(chunk)
    return bytes(value)


def read_frame(connection, deadline):
    prefix = read_exact(connection, 4, deadline)
    if not re.fullmatch(b"[0-9a-fA-F]{4}", prefix):
        raise NativeTransportError("transport-protocol-invalid")
    return read_exact(connection, int(prefix, 16), deadline)


def selected_transport(payload, selector):
    try:
        lines = payload.decode("utf-8", errors="strict").splitlines()
        if len(payload) > 65535 or len(lines) > 256:
            raise ValueError()
        matches = [line.split() for line in lines if line.split() and line.split()[0] == selector]
        if len(matches) != 1:
            raise ValueError()
        fields = matches[0]
        if len(fields) < 3 or fields[1] != "device" or not re.fullmatch(r"transport_id:[1-9][0-9]{0,19}", fields[-1]):
            raise ValueError()
        transport_id = int(fields[-1].split(":", 1)[1])
        if transport_id > 2**64 - 1:
            raise ValueError()
        return transport_id
    except Exception:
        raise NativeTransportError("transport-state-invalid") from None


def open_service(binding, service, deadline):
    if service not in ("host:track-devices-l", "host:devices-l"):
        raise NativeTransportError("transport-service-invalid")
    connection = None
    try:
        host, port = binding[:2]
        connection = socket.create_connection(("127.0.0.1" if host == "localhost" else host, port), timeout=remaining(deadline))
        request = service.encode("ascii")
        connection.settimeout(remaining(deadline))
        connection.sendall(f"{len(request):04x}".encode() + request)
        if read_exact(connection, 4, deadline) != b"OKAY":
            raise NativeTransportError("transport-protocol-invalid")
        return connection
    except Exception:
        if connection is not None:
            connection.close()
        raise NativeTransportError("transport-unavailable") from None


def query_transport(binding, deadline):
    with open_service(binding, "host:devices-l", deadline) as connection:
        result = selected_transport(read_frame(connection, deadline), binding[2])
        connection.settimeout(remaining(deadline))
        if connection.recv(1):
            raise NativeTransportError("transport-protocol-invalid")
        return result
