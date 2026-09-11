"""ADB host serviceだけを模すloopback peer。ADBや実端末は起動しない。"""
import select
import socket
import socketserver
import threading
from types import SimpleNamespace

SELECTOR = "private-selector"


def listing(transport_id=7, state="device", selector=SELECTOR):
    return f"{selector:<22} {state} product:fixture model:fixture device:fixture transport_id:{transport_id}\n".encode()


def frame(payload):
    return f"{len(payload):04x}".encode() + payload


class AdbPeer:
    def __init__(self):
        self.snapshot = listing()
        self.requests = []
        self.clients = set()
        self.workers = set()
        self.lock = threading.Lock()
        self.stopping = threading.Event()
        self.raw_reply = None
        self.delay = 0
        self.fragment = False
        peer = self

        class Handler(socketserver.BaseRequestHandler):
            def handle(self):
                worker = threading.current_thread()
                with peer.lock:
                    peer.workers.add(worker)
                try:
                    self.request.settimeout(1)
                    def read(length):
                        value = b""
                        while len(value) < length:
                            part = self.request.recv(length - len(value))
                            if not part:
                                raise OSError()
                            value += part
                        return value
                    operation = read(int(read(4), 16)).decode("ascii")
                    with peer.lock:
                        peer.requests.append(operation)
                    if operation not in ("host:track-devices-l", "host:devices-l"):
                        self.request.sendall(b"FAIL0007unknown")
                        return
                    if peer.stopping.wait(peer.delay):
                        return
                    with peer.lock:
                        response = peer.raw_reply if peer.raw_reply is not None else b"OKAY" + frame(peer.snapshot)
                        if operation == "host:track-devices-l":
                            peer.clients.add(self.request)
                        if peer.fragment:
                            for part in (response[:1], response[1:3], response[3:7], response[7:]):
                                self.request.sendall(part)
                        else:
                            self.request.sendall(response)
                    if operation == "host:track-devices-l":
                        while not peer.stopping.is_set():
                            if select.select([self.request], [], [], 0.02)[0] and not self.request.recv(1):
                                break
                except (OSError, ValueError):
                    pass
                finally:
                    with peer.lock:
                        peer.clients.discard(self.request)
                        peer.workers.discard(worker)

        class Server(socketserver.ThreadingTCPServer):
            daemon_threads = True
            allow_reuse_address = True
        self.server = Server(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=0.02), daemon=True)
        self.thread.start()
        self.adb = SimpleNamespace(host="127.0.0.1", port=self.server.server_address[1], adb_path="fixture-adb.exe", serialno=SELECTOR)
        self.adb.cmd_options = [self.adb.adb_path, "-P", str(self.adb.port)]

    def publish(self, payload):
        with self.lock:
            self.snapshot = payload
            for client in list(self.clients):
                try:
                    client.sendall(frame(payload))
                except OSError:
                    pass

    def disconnect_trackers(self):
        with self.lock:
            for client in list(self.clients):
                try:
                    client.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def close(self):
        self.stopping.set()
        self.disconnect_trackers()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=1)
        with self.lock:
            workers = list(self.workers)
        for worker in workers:
            worker.join(timeout=1)
        if self.thread.is_alive() or any(worker.is_alive() for worker in workers):
            raise AssertionError("fixture peer thread leaked")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
