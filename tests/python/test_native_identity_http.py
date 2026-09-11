"""Python HTTP入口と任意の明示的Node相互運用probe。実端末は使わない。"""
import http.client
import json
from pathlib import Path
import threading
import unittest
import uuid
from bridge_fixture import bridge
import test_native_identity_exchange as cases


class IdentityHttpTests(unittest.TestCase):
    def setUp(self):
        self.fixture = cases.IdentityExchangeTests()
        self.fixture.setUp()
        self.state = self.fixture.state
        handler = type("IdentityFixtureHandler", (bridge.Handler,), {"state": self.state})
        self.server = bridge.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=0.02), daemon=True)
        self.thread.start()
        self.endpoint = "http://127.0.0.1:" + str(self.server.server_port) + "/operator/"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.assertFalse(self.thread.is_alive())
        self.fixture.tearDown()

    def opening(self, endpoint=None):
        return {"schemaVersion": "lakda/native-identity-open/v1", "challenge": str(uuid.uuid4()), "maxAgeMs": 60000,
                "bridgeBinding": {"capabilityDigest": cases.exchange._digest(self.state.capabilities()),
                                  "bridgeDigest": cases.exchange._digest({"transport": "loopback-json/v1", "endpoint": endpoint or self.endpoint})}}

    def post(self, operation, value, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        try:
            body = value if isinstance(value, bytes) else json.dumps(value).encode()
            connection.request("POST", "/operator/" + operation, body=body, headers={"Content-Type": "application/json", **(headers or {})})
            response = connection.getresponse()
            self.assertEqual(response.getheader("Content-Type"), "application/json")
            result = response.status, json.loads(response.read())
            self.assertNotIn(cases.RAW, json.dumps(result))
            return result
        finally:
            connection.close()

    def test_http_roundtrip_uses_real_handler_and_provider_with_a_path_prefix(self):
        status, session = self.post("native-identity-open", self.opening())
        self.assertEqual(status, 200)
        request = self.fixture.observing(session)
        status, result = self.post("native-identity-observe", request)
        self.assertEqual(status, 200)
        self.assertEqual(result["fields"]["appBuild"]["value"], "42")
        self.assertEqual(result["bridgeBinding"]["connectionId"], session["connectionId"])
        self.assertEqual(self.post("native-identity-observe", request)[0], 409)
        self.assertEqual(len(self.fixture.commands), 5)

    def test_http_host_and_binding_must_match_the_actual_listener(self):
        self.assertEqual(self.post("native-identity-open", self.opening(), {"Host": "example.invalid"})[0], 400)
        invalid = self.opening()
        invalid["bridgeBinding"]["bridgeDigest"] = "sha256:" + "f" * 64
        self.assertEqual(self.post("native-identity-open", invalid)[0], 409)
        endpoint = "http://localhost:" + str(self.server.server_port) + "/operator/"
        self.assertEqual(self.post("native-identity-open", self.opening(endpoint), {"Host": "localhost:" + str(self.server.server_port)})[0], 200)
        self.fixture.provider.assert_not_called()

    def test_http_rejects_large_unknown_and_malformed_requests(self):
        self.assertEqual(self.post("native-identity-open", b" " * 4097)[0], 413)
        self.assertEqual(self.post("native-identity-open", {**self.opening(), "unknown": "private-canary"})[0], 400)
        self.assertEqual(self.post("native-identity-open", b"\xff")[0], 400)
        self.assertEqual(self.post("native-identity-open?query=1", self.opening())[0], 404)
        self.assertEqual(self.post("native-identity-open", self.opening(), {"Origin": "https://example.invalid"})[0], 403)
        self.fixture.provider.assert_not_called()

    def test_http_connection_change_consumes_the_lease_without_provider_calls(self):
        status, session = self.post("native-identity-open", self.opening())
        self.assertEqual(status, 200)
        request = self.fixture.observing(session)
        original = self.state.device.adb.serialno
        self.state.device.adb.serialno = "another-selector"
        self.assertEqual(self.post("native-identity-observe", request)[0], 409)
        self.state.device.adb.serialno = original
        self.assertEqual(self.post("native-identity-observe", request)[0], 409)
        self.fixture.provider.assert_not_called()

    def test_http_provider_exception_does_not_publish_private_details(self):
        _, session = self.post("native-identity-open", self.opening())
        self.fixture.provider.side_effect = RuntimeError(cases.RAW + " private-path")
        self.assertEqual(self.post("native-identity-observe", self.fixture.observing(session)), (412, {"error": "native-identity: provider-unavailable"}))


def interop(node):
    """明示実行時だけ、build済みNode clientを同じfixture HTTPへ接続する。"""
    import os
    import subprocess
    fixture = IdentityHttpTests()
    fixture.setUp()
    try:
        script = """
import { randomUUID } from 'node:crypto';
import { LoopbackJsonBridge } from './dist/adapters/loopback-json.js';
import { nativeBuildMappingDigest } from './dist/exploration/native-identity-contracts.js';
import { verifyNativeIdentityObservation } from './dist/exploration/native-identity.js';
const bridge = await LoopbackJsonBridge.connect(process.env.LAKDA_NATIVE_INTEROP_ENDPOINT, 'airtest-poco');
const result = await bridge.observeNativeIdentity();
const provider = { name: 'lakda-airtest-android', version: '1.0.0-airtest-1.3.5' };
const mapping = { schemaVersion:'lakda/native-build-mapping/v1', mappingId:randomUUID(), platform:'android', provider,
  appId:'org.example.fixture', entries:[{observedBuild:'42',targetRevision:'approved-revision'}] };
const proof = verifyNativeIdentityObservation(result.observation, { platform:'android', appId:'org.example.fixture', targetRevision:'approved-revision',
  deviceDigest:'sha256:2ed25b90cc813d5fb19ada61d2a6a4a8c7a541f50dd3a0d5bd22844f8ba15089', bridgeBinding:result.observation.bridgeBinding,
  challenge:result.observation.challenge, mapping, mappingDigest:nativeBuildMappingDigest(mapping), allowedProviders:[provider],
  requestedAt:result.requestedAt, now:result.now, elapsedMs:result.elapsedMs });
console.log(JSON.stringify({status:'passed',verifiedTargetRevision:proof.targetRevision,platform:proof.platform,provider:proof.provider}));
"""
        result = subprocess.run([node, "--input-type=module"], input=script, encoding="utf-8", capture_output=True,
                                cwd=Path(__file__).resolve().parents[2], env={**os.environ, "LAKDA_NATIVE_INTEROP_ENDPOINT": fixture.endpoint}, timeout=25)
        if result.returncode != 0:
            raise RuntimeError("native identity Node interop failed: " + result.stderr)
        value = json.loads(result.stdout)
        assert cases.RAW not in result.stdout + result.stderr
        assert len(fixture.fixture.commands) == 5 and fixture.fixture.provider.call_count == 1
        print(json.dumps({**value, "executionMode": "fixture", "deviceConnected": False, "sdkQueries": 5, "providerCalls": 1}))
    finally:
        fixture.tearDown()


if __name__ == "__main__":
    import sys
    if len(sys.argv) == 3 and sys.argv[1] == "--interop-node":
        interop(sys.argv[2])
    else:
        unittest.main()
