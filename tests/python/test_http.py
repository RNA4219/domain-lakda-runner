"""実HTTP handlerをfixture loopbackだけへ公開して契約検証する。"""
import http.client
import json
import threading
from types import SimpleNamespace
import unittest
from bridge_fixture import bridge


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.calls = 0

        def capabilities():
            self.calls += 1
            return {"fixture": True}

        handler = type("FixtureHandler", (bridge.Handler,), {
            "state": SimpleNamespace(capabilities=capabilities),
        })
        self.server = bridge.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.assertFalse(self.thread.is_alive())

    def post(self, body=b"{}", path="/capabilities", **headers):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=2)
        try:
            values = {"Content-Type": "application/json", **headers}
            connection.request("POST", path, body=body, headers=values)
            response = connection.getresponse()
            self.assertEqual(response.getheader("Content-Type"), "application/json")
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def test_valid_json_and_same_origin(self):
        origin = "http://127.0.0.1:" + str(self.server.server_port)
        self.assertEqual(self.post(Origin=origin), (200, {"fixture": True}))
        self.assertEqual(self.calls, 1)

    def test_wrong_content_type_and_origin_never_dispatch(self):
        self.assertEqual(self.post(body=b"", **{"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.post(body=b"", Origin="https://unapproved.invalid")[0], 403)
        self.assertEqual(self.calls, 0)

    def test_request_size_limits_never_dispatch(self):
        # Header-only refusals do not send unread bytes after the declared body.
        for length in ("0", "-1", "invalid", str(bridge.MAX_JSON_BYTES + 1)):
            with self.subTest(length=length):
                self.assertEqual(self.post(body=b"", **{"Content-Length": length})[0], 413)
        self.assertEqual(self.calls, 0)

    def test_invalid_json_utf8_and_non_objects_are_client_errors(self):
        for body in (b"{", b"\xff", b"[]", b"null", b"42", b'{"number":NaN}', b'{"number":Infinity}'):
            with self.subTest(body=body):
                self.assertEqual(self.post(body)[0], 400)
        self.assertEqual(self.calls, 0)

    def test_unknown_operation(self):
        self.assertEqual(self.post(path="/unsupported")[0], 404)
        self.assertEqual(self.calls, 0)
