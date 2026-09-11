"""native-actionの実HTTP入口を人工deviceで検証する。"""
import unittest
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch
from native_transport_fixture import AdbPeer
import test_native_identity_http as http_cases
import test_native_identity_actions as actions
import test_native_identity_exchange as cases


class NativeActionHttpTests(unittest.TestCase):
    def setUp(self):
        self.http = http_cases.IdentityHttpTests()
        self.http.setUp()
        self.state = self.http.state
        self.state.device.touch = Mock()
        self.state.device.keyevent = Mock()
        self.state.airtest.device = lambda: self.state.device
        self.state.airtest.touch = Mock()
        self.state.airtest.keyevent = Mock()
        self.state._assert_fresh_candidate = Mock(return_value={"ui": {"screen": {"resolution": [100, 200]}}})

    def tearDown(self):
        self.http.tearDown()

    def request(self):
        status, session = self.http.post("native-identity-open", self.http.opening())
        self.assertEqual(status, 200)
        status, observation = self.http.post("native-identity-observe", self.http.fixture.observing(session))
        self.assertEqual(status, 200)
        return actions.NativeActionTests.request(self, observation)

    def test_http_executes_and_recovers_once_with_bound_acknowledgements(self):
        request = self.request()
        status, result = self.http.post("native-action", request)
        self.assertEqual(status, 200)
        self.assertEqual(result["result"]["status"], "executed")
        self.assertEqual(result["lease"], request["lease"])
        self.assertTrue(result["actionAttempted"])
        self.assertEqual(self.http.post("native-action", request)[0], 409)
        request.update(operation="recover", ordinal=2, payload={"failure": {}, "context": {}})
        status, recovered = self.http.post("native-action", request)
        self.assertEqual(status, 200)
        self.assertTrue(recovered["result"]["recovered"])
        self.state.device.touch.assert_called_once()
        self.state.device.keyevent.assert_called_once_with("BACK")
        self.state.airtest.touch.assert_not_called()
        self.state.airtest.keyevent.assert_not_called()

    def test_http_v2_window_is_echoed_and_cannot_be_extended(self):
        request = self.request()
        now = datetime.now(timezone.utc)
        stamp = lambda value: value.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        request.update(schemaVersion="lakda/native-action-request/v2", approvalWindow={
            "targetManifestSha256": "sha256:" + "e" * 64, "validFrom": stamp(now - timedelta(seconds=1)), "validUntil": stamp(now + timedelta(seconds=10))})
        status, result = self.http.post("native-action", request)
        self.assertEqual(status, 200)
        self.assertEqual(result["schemaVersion"], "lakda/native-action-result/v2")
        self.assertEqual(result["approvalWindow"], request["approvalWindow"])
        request["ordinal"] = 2
        request["approvalWindow"]["validUntil"] = stamp(now + timedelta(seconds=20))
        self.assertEqual(self.http.post("native-action", request)[0], 409)
        self.state.device.touch.assert_called_once()

    def test_http_v2_missing_and_expired_windows_have_no_sdk_action(self):
        request = self.request()
        request["schemaVersion"] = "lakda/native-action-request/v2"
        self.assertEqual(self.http.post("native-action", request)[0], 400)
        request["approvalWindow"] = {"targetManifestSha256": "sha256:" + "e" * 64,
                                     "validFrom": "2000-01-01T00:00:00.000Z", "validUntil": "2000-01-02T00:00:00.000Z"}
        self.assertEqual(self.http.post("native-action", request)[0], 409)
        self.state.device.touch.assert_not_called()

    def test_http_rejects_host_oversize_malformed_and_unknown_requests_before_sdk(self):
        request = self.request()
        self.assertEqual(self.http.post("native-action", request, {"Host": "example.invalid"})[0], 400)
        self.assertEqual(self.http.post("native-action", b"", {"Content-Length": "65537"})[0], 413)
        self.assertEqual(self.http.post("native-action", b"\xff")[0], 400)
        self.assertEqual(self.http.post("native-action", {**request, "unknown": "private-canary"})[0], 400)
        self.assertEqual(self.http.post("native-action?query=1", request)[0], 404)
        self.state.device.touch.assert_not_called()

    def test_http_old_observation_or_changed_connection_cannot_start_an_action(self):
        for key in ("digest", "connection"):
            request = self.request()
            original = self.state.device.adb.serialno
            if key == "digest":
                request["lease"]["observationDigest"] = "sha256:" + "f" * 64
            else:
                self.state.device.adb.serialno = "changed"
            self.assertEqual(self.http.post("native-action", request)[0], 409)
            self.state.device.adb.serialno = original
        self.state.device.touch.assert_not_called()

    def test_http_sdk_failure_retains_attempted_state_without_private_error_text(self):
        request = self.request()
        self.state.device.touch.side_effect = RuntimeError(cases.RAW)
        status, result = self.http.post("native-action", request)
        self.assertEqual(status, 200)
        self.assertEqual(result["result"]["status"], "infrastructure_error")
        self.assertTrue(result["actionAttempted"])
        request["ordinal"] = 2
        self.assertEqual(self.http.post("native-action", request)[0], 409)

    def test_legacy_execute_keeps_its_response_contract(self):
        request = self.request()
        status, result = self.http.post("execute", request["payload"])
        self.assertEqual(status, 200)
        self.assertEqual(result["schemaVersion"], "lakda/adaptive-contracts/v1")
        self.assertNotIn("actionAttempted", result)
        self.state.airtest.touch.assert_called_once()
        self.state.device.touch.assert_not_called()

def interop(node):
    import subprocess
    import native_identity_transport_protocol as protocol
    from pathlib import Path
    environment = patch.dict(os.environ, {key: value for key, value in os.environ.items() if key not in protocol.SERVER_ENV}, clear=True)
    case = NativeActionHttpTests()
    case.setUp()
    case.state.target_revision = "approved-revision"
    peer = AdbPeer()
    environment.start()
    try:
        for key in ("host", "port", "adb_path", "cmd_options"):
            setattr(case.state.device.adb, key, getattr(peer.adb, key))
        exchange = case.state.native_identity_exchange
        exchange._transport_factory = cases.exchange.NativeAndroidTransport
        script = r"""
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { LoopbackJsonBridge } from './dist/adapters/loopback-json.js';
import { nativeIdentityDigest, nativeBuildMappingDigest } from './dist/exploration/native-identity-contracts.js';
import { createNativeIdentityExecutor } from './dist/exploration/native-identity-executor.js';
import { createSessionNativeEvidenceSink, readSessionNativeEvidence } from './dist/exploration/native-identity-evidence-store.js';
import { createExplorationSession, appendSessionEvent } from './dist/exploration/session.js';
import { targetManifestSigningPayload } from './dist/exploration/target-manifest.js';
const endpoint = process.argv[1], bridge = await LoopbackJsonBridge.connect(endpoint, 'airtest-poco');
const appId = 'org.example.fixture', targetRevision = 'approved-revision', digest = value => 'sha256:' + value.repeat(64);
const provider = { name: 'lakda-airtest-android', version: '1.0.0-airtest-1.3.5' };
const mapping = { schemaVersion: 'lakda/native-build-mapping/v1', mappingId: '00000000-0000-4000-8000-000000000004',
  platform: 'android', appId, provider, entries: [{ observedBuild: '42', targetRevision }] };
const charter = JSON.parse(readFileSync('examples/exploration-charter.playwright.json', 'utf8'));
delete charter.baseUrl;
Object.assign(charter, { platform: 'android', executionMode: 'real', targetRevision,
  targetManifestPath: 'fixture-target.json', trustStorePath: 'fixture-trust.json',
  templateCorpus: { path: 'fixture-templates.json', version: charter.templateCorpusVersion, sha256: nativeIdentityDigest([]) },
  adapter: { id: 'airtest-poco', endpoint, initialTarget: { targetId: 'fixture-device', kind: 'device' } },
  scope: { allowHosts: ['127.0.0.1'], native: { appId, surfaces: ['android'], denyZones: [] } } });
charter.capture.sampledFrames.source = 'operator-bridge';
const config = {}, configDigest = nativeIdentityDigest(config);
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const manifest = {
  schemaVersion: 'lakda/exploration-target-manifest/v2', manifestId: 'native-action-fixture', status: 'ready', owner: 'fixture',
  charterDigest: nativeIdentityDigest(charter), configDigest, targetRevision, platform: 'android', adapterId: 'airtest-poco',
  executionMode: 'real', target: { identity: { kind: 'native', appId }, templateCorpusDigest: charter.templateCorpus.sha256 }, bridgeBinding: bridge.binding(),
  safety: { allowMutationKinds: ['none'], resetProcedureRef: 'fixture-reset', killSwitchRef: 'fixture-kill' },
  nativeIdentity: { deviceDigest: 'sha256:2ed25b90cc813d5fb19ada61d2a6a4a8c7a541f50dd3a0d5bd22844f8ba15089',
    allowedProviders: [provider], requiredFields: ['appId', 'appBuild', 'deviceDigest'], maxAgeMs: 60000,
    buildMappings: [{ mapping, mappingDigest: nativeBuildMappingDigest(mapping) }] },
  signature: { algorithm: 'ed25519', keyId: 'fixture-operator', validFrom: new Date(Date.now() - 1000).toISOString(), validUntil: new Date(Date.now() + 10000).toISOString(),
    approvalEvidenceRef: 'fixture-approval', signedPayloadDigest: digest('0'), valueBase64: 'AA==' },
};
const payload = targetManifestSigningPayload(manifest);
const { createHash } = await import('node:crypto');
manifest.signature.signedPayloadDigest = 'sha256:' + createHash('sha256').update(payload).digest('hex');
manifest.signature.valueBase64 = sign(null, Buffer.from(payload), privateKey).toString('base64');
const targetBytes = Buffer.from(JSON.stringify(manifest));
const target = { manifest, sha256: 'sha256:' + createHash('sha256').update(targetBytes).digest('hex') };
const evidenceRoot = await mkdtemp(resolve('.lakda/native-identity-evidence-interop-'));
const { paths } = await createExplorationSession(charter, config, evidenceRoot);
await writeFile(paths.targetManifest, targetBytes);
await appendSessionEvent(paths, { type: 'checkpoint', payload: { targetManifestDigest: target.sha256 } });
const evidence = await createSessionNativeEvidenceSink(paths, target);
const executor = await createNativeIdentityExecutor({ targetBytes, charter, configDigest, bridge, evidence,
  trustKeys: [{ keyId: 'fixture-operator', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() }],
});
const candidate = { schemaVersion: 'lakda/adaptive-contracts/v1', candidateId: 'candidate-1', adapterId: 'airtest-poco',
  targetRef: { targetId: 'fixture-device', kind: 'device' }, sourceFingerprint: 'source-1', actionKind: 'back',
  locatorRecipe: { strategy: 'image', value: 'back' }, generatedBy: { ruleId: 'fixture', observationId: 'observation-1', reason: 'fixture back' },
  risk: { weight: 1 }, mutationKind: 'none' };
const executed = await executor.perform({ operation: 'execute',
  payload: { candidate, context: { runId: 'fixture-run', timeoutMs: 1000 } } });
const recovered = await executor.perform({ operation: 'recover',
  payload: { failure: { category: 'timeout', messageRef: 'fixture-failure' }, context: { runId: 'fixture-run', strategy: 'back' } } });
if (executed.result.status !== 'executed' || !recovered.result.recovered || !executed.actionAttempted || !recovered.actionAttempted) throw new Error('fixture action failed');
if (executed.approvalWindow.targetManifestSha256 !== executor.targetManifestSha256 || recovered.approvalWindow.validUntil !== manifest.signature.validUntil) throw new Error('fixture window mismatch');
const saved = await readSessionNativeEvidence(paths, target);
if (!saved.complete || saved.records.length !== 5 || saved.records[2].evidence.receipt.operation !== 'execute' || saved.records[4].evidence.receipt.operation !== 'recover') throw new Error('fixture native evidence mismatch');
process.stdout.write(JSON.stringify({ status: 'passed', executionMode: 'fixture', deviceConnected: false, approval: 'fixture-key-only',
  nativeEvidenceRecords: saved.records.length, nativeEvidenceComplete: saved.complete, nativeEvidenceSession: relative(process.cwd(), paths.root).replaceAll('\\', '/'),
  schemaVersion: executed.schemaVersion, windowBinding: true, targetRevision, ordinals: [executed.ordinal, recovered.ordinal], attempted: [executed.actionAttempted, recovered.actionAttempted] }));
"""
        completed = subprocess.run([node, "--input-type=module", "-e", script, case.http.endpoint], cwd=Path(__file__).resolve().parents[2],
                                   capture_output=True, text=True, timeout=30, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if completed.returncode != 0:
            print("fixture failure counters: sdk_actions=" + str(case.state.device.keyevent.call_count)
                  + " transport_queries=" + str(peer.requests.count("host:devices-l")), file=__import__("sys").stderr)
            raise RuntimeError(completed.stderr)
        import json
        result = json.loads(completed.stdout)
        case.assertEqual(case.state.device.keyevent.call_count, 2)
        case.state.airtest.keyevent.assert_not_called()
        case.assertEqual(peer.requests.count("host:track-devices-l"), 1)
        case.assertEqual(set(peer.requests), {"host:track-devices-l", "host:devices-l"})
        result.update(sdkQueries=len(case.http.fixture.commands), fakeSdkActions=case.state.device.keyevent.call_count,
                      sharedApiActions=case.state.airtest.keyevent.call_count, adbTransportTracking=True,
                      trackerConnections=peer.requests.count("host:track-devices-l"), transportQueries=peer.requests.count("host:devices-l"))
    finally:
        try:
            case.tearDown()
            peer.close()
        finally:
            environment.stop()
    case.assertFalse(exchange._transport.thread.is_alive())
    result["transportReaderStopped"] = True
    print(json.dumps(result))


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--interop-node")
    args = parser.parse_args()
    if args.interop_node:
        interop(args.interop_node)
    else:
        unittest.main(argv=["test_native_identity_actions_http.py"])
