"""Node/Pythonと実HTTP handlerの撮影接続。SDKは人工fixture。"""
import copy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import test_native_identity_http as cases


class NativeCaptureHttpTests(unittest.TestCase):
    def setUp(self):
        self.http = cases.IdentityHttpTests()
        self.http.setUp()
        self.state, self.root = self.http.state, self.http.fixture.root
        self.device = self.state.device
        self.device.adb.snapshot = Mock(return_value=b"\x89PNG\r\n\x1a\nfixture")
        self.device.adb.display_id = None
        self.device.recorder = None
        self.device.yosemite_recorder = SimpleNamespace(adb=self.device.adb, recording_proc=None)
        self.state.airtest.device = lambda: self.state.device

        def start(**value):
            Path(value["output"]).write_bytes(b"fixture-video")
            self.device.yosemite_recorder.recording_proc = object()
            return value["output"]

        def stop():
            self.device.yosemite_recorder.recording_proc = None
            return True

        self.device.start_recording, self.device.stop_recording = Mock(side_effect=start), Mock(side_effect=stop)

    def tearDown(self):
        self.http.tearDown()

    def request(self, operation="screenshot"):
        status, session = self.http.post("native-identity-open", self.http.opening())
        self.assertEqual(status, 200)
        status, observation = self.http.post("native-identity-observe", self.http.fixture.observing(session))
        self.assertEqual(status, 200)
        now = datetime.now(timezone.utc)
        iso = lambda value: value.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        payload = {"runId": "fixture-run", "stagingDir": str(self.root / "fixture-run")}
        if operation != "screenshot":
            payload.update(mode="video", maxBytes=1024, stopTimeoutMs=500)
        return {"schemaVersion": "lakda/native-capture-request/v1", "operation": operation, "ordinal": 1, "captureOrdinal": 1,
                "lease": {"observationId": observation["observationId"], "observationDigest": cases.cases.exchange._digest(observation),
                          "connectionId": session["connectionId"], "challenge": session["challenge"]},
                "approvalWindow": {"targetManifestSha256": "sha256:" + "e" * 64,
                                   "validFrom": iso(now - timedelta(seconds=1)), "validUntil": iso(now + timedelta(seconds=30))}, "payload": payload}

    def test_http_uses_bound_guard_and_rejects_malformed_oversize_and_changed_receipts(self):
        request = self.request()
        self.assertEqual(self.http.post("native-capture", {**request, "unknown": "private-canary"})[0], 400)
        self.assertEqual(self.http.post("native-capture", b"", {"Content-Length": "65537"})[0], 413)
        self.assertEqual(self.http.post("native-capture", b"\xff")[0], 400)
        status, response = self.http.post("native-capture", request)
        self.assertEqual(status, 200)
        self.assertTrue(response["result"]["accepted"])
        self.assertEqual(self.http.post("native-capture", request), (status, response))
        request["payload"]["runId"] = "another"
        self.assertEqual(self.http.post("native-capture", request)[0], 409)
        self.device.adb.snapshot.assert_called_once()
        self.assertEqual(self.state.airtest.frame_count, 0)

    def test_sampled_frames_stop_publishes_only_frames_from_the_guard(self):
        request = self.request("start")
        request["payload"].update(mode="sampled-frames/v1", intervalMs=1, maxFrames=2)
        self.assertTrue(self.http.post("native-capture", request)[1]["result"]["accepted"])
        deadline = time.monotonic() + 1
        while self.device.adb.snapshot.call_count < 2 and time.monotonic() < deadline:
            time.sleep(0.01)
        request.update(operation="stop", ordinal=2)
        result = self.http.post("native-capture", request)[1]["result"]
        self.assertTrue(result["stopped"])
        self.assertEqual(result["frameCount"], 2)
        self.assertEqual(len(result["artifactRefs"]), 2)
        self.assertEqual(self.state.airtest.frame_count, 0)

    def test_native_capture_response_uses_its_bounded_four_mib_contract(self):
        value = {"fixture": "x" * (1024 * 1024 + 1)}
        with patch.object(self.state.native_identity_exchange.captures, "perform", return_value=value):
            self.assertEqual(self.http.post("native-capture", {})[0], 200)
        value["fixture"] = "x" * (4 * 1024 * 1024 + 1)
        with patch.object(self.state.native_identity_exchange.captures, "perform", return_value=value):
            self.assertEqual(self.http.post("native-capture", {})[0], 500)
        with patch.object(self.state, "capture_evidence", return_value=value):
            self.assertEqual(self.http.post("capture-evidence", {})[0], 500)
        self.device.adb.snapshot.assert_not_called()


def interop(node):
    import os
    import subprocess
    fixture = NativeCaptureHttpTests()
    fixture.setUp()
    try:
        script = """
import assert from 'node:assert/strict';
import { LoopbackJsonBridge } from './dist/adapters/loopback-json.js';
import { nativeActionLease } from './dist/exploration/native-identity-actions.js';
const bridge = await LoopbackJsonBridge.connect(process.env.LAKDA_NATIVE_INTEROP_ENDPOINT, 'airtest-poco');
const acquired = await bridge.observeNativeIdentity();
const now = Date.now();
const common = {schemaVersion:'lakda/native-capture-request/v1',lease:nativeActionLease(acquired.observation),
  approvalWindow:{targetManifestSha256:'sha256:'+'e'.repeat(64),validFrom:new Date(now-1000).toISOString(),validUntil:new Date(now+30000).toISOString()}};
const payload = {runId:'fixture-run',stagingDir:process.env.LAKDA_NATIVE_INTEROP_STAGING,mode:'video',maxBytes:1024,stopTimeoutMs:500};
const start = {...common,operation:'start',ordinal:1,captureOrdinal:1,payload};
assert.equal((await bridge.nativeCapture(start)).result.accepted,true);
const shot = {...common,operation:'screenshot',ordinal:2,captureOrdinal:2,payload:{runId:payload.runId,stagingDir:payload.stagingDir}};
assert.equal((await bridge.nativeCapture(shot)).result.artifactRefs.length,1);
const stop = {...common,operation:'stop',ordinal:3,captureOrdinal:1,payload};
await assert.rejects(bridge.nativeCapture({...stop,payload:{...payload,stagingDir:payload.stagingDir+'-other'}}));
const receipt = await bridge.nativeCapture(stop);
assert.equal(receipt.result.stopped,true); assert.ok(receipt.result.artifactRefs[0].path.endsWith('.mp4'));
assert.deepEqual(await bridge.nativeCapture(stop),receipt);
await assert.rejects(bridge.nativeCapture(start));
assert.equal((await bridge.nativeCapture({...shot,ordinal:4,captureOrdinal:4})).result.accepted,true);
console.log(JSON.stringify({status:'passed',executionMode:'fixture',deviceConnected:false,videoStarts:1,videoStops:1,screenshots:2}));
"""
        result = subprocess.run([node, "--input-type=module"], input=script, encoding="utf-8", capture_output=True,
                                cwd=Path(__file__).resolve().parents[2], timeout=25,
                                env={**os.environ, "LAKDA_NATIVE_INTEROP_ENDPOINT": fixture.http.endpoint,
                                     "LAKDA_NATIVE_INTEROP_STAGING": str(fixture.root / "fixture-run")})
        if result.returncode != 0:
            raise RuntimeError("capture interop failed: " + result.stderr)
        fixture.device.start_recording.assert_called_once()
        fixture.device.stop_recording.assert_called_once()
        assert fixture.device.adb.snapshot.call_count == 2
        assert fixture.state.airtest.frame_count == 0 and fixture.state.airtest.starts == 0 and fixture.state.airtest.stops == 0
        assert cases.cases.RAW not in result.stdout + result.stderr
        print(json.dumps(json.loads(result.stdout)))
    finally:
        fixture.tearDown()


if __name__ == "__main__":
    import sys
    if len(sys.argv) == 3 and sys.argv[1] == "--interop-node":
        interop(sys.argv[2])
    else:
        unittest.main()
