"""承認期間は署名検証済みNodeから渡す制約。実鍵・実機を使わない。"""
import copy
from datetime import datetime, timezone
import time
import unittest
from unittest.mock import patch
import test_native_identity_actions as cases
import native_identity_actions as actions


def iso(milliseconds):
    return datetime.fromtimestamp(milliseconds / 1000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class NativeWindowTests(unittest.TestCase):
    def setUp(self):
        self.fixture = cases.NativeActionTests()
        self.fixture.setUp()
        self.state = self.fixture.state

    def tearDown(self):
        self.fixture.tearDown()

    def request(self):
        request = self.fixture.request()
        self.now = actions.clock.wall_milliseconds() + 10
        request.update(schemaVersion="lakda/native-action-request/v2", approvalWindow={
            "targetManifestSha256": "sha256:" + "e" * 64,
            "validFrom": iso(self.now - 1000), "validUntil": iso(self.now + 5000)})
        return request

    def perform(self, request):
        return self.fixture.perform(request)

    def test_execute_recovery_and_response_keep_window(self):
        request = self.request()
        with patch.object(actions.clock, "wall_milliseconds", return_value=self.now):
            result = self.perform(request)
            self.assertEqual(result["schemaVersion"], "lakda/native-action-result/v2")
            self.assertEqual(result["approvalWindow"], request["approvalWindow"])
            self.assertTrue(result["actionAttempted"])
            request.update(operation="recover", ordinal=2, payload={"failure": {}, "context": {}})
            self.assertTrue(self.perform(request)["result"]["recovered"])
        self.state.device.touch.assert_called_once()
        self.state.device.keyevent.assert_called_once_with("BACK")

    def test_expiry_and_future_window_reject_before_preparation(self):
        for field, value in (("validUntil", -1), ("validUntil", 0), ("validFrom", 1)):
            request = self.request()
            request["approvalWindow"][field] = iso(self.now + value)
            with patch.object(actions.clock, "wall_milliseconds", return_value=self.now):
                with self.assertRaisesRegex(Exception, "approval-window-expired"):
                    self.perform(request)
        self.state._assert_fresh_candidate.assert_not_called()
        self.state.device.touch.assert_not_called()

    def test_window_is_closed_canonical_and_nonempty(self):
        for field, value in (("targetManifestSha256", "private-raw"), ("extra", True),
                             ("validFrom", "2026-02-30T00:00:00.000Z"), ("validUntil", "2026-09-10T00:00:00Z"),
                             ("validUntil", "2026-09-10T00:00:00.000+00:00"), ("validUntil", "0000-01-01T00:00:00.000Z")):
            request = self.request()
            request["approvalWindow"][field] = value
            with self.assertRaisesRegex(Exception, "action-request-invalid"):
                self.perform(request)
        request = self.request()
        request["approvalWindow"]["validUntil"] = request["approvalWindow"]["validFrom"]
        with self.assertRaisesRegex(Exception, "action-request-invalid"):
            self.perform(request)
        self.state.device.touch.assert_not_called()

    def test_bound_window_cannot_be_changed_or_downgraded(self):
        for change in ("targetManifestSha256", "validFrom", "validUntil", "version"):
            request = self.request()
            with patch.object(actions.clock, "wall_milliseconds", return_value=self.now):
                self.perform(request)
                changed = copy.deepcopy(request)
                changed["ordinal"] = 2
                if change == "version":
                    changed["schemaVersion"] = "lakda/native-action-request/v1"
                    del changed["approvalWindow"]
                else:
                    changed["approvalWindow"][change] = "sha256:" + "a" * 64 if change == "targetManifestSha256" else iso(self.now + (10000 if change == "validUntil" else -2000))
                with self.assertRaisesRegex(Exception, "approval-window-mismatch"):
                    self.perform(changed)
                request["ordinal"] = 2
                with self.assertRaisesRegex(Exception, "lease-unavailable"):
                    self.perform(request)
        self.assertEqual(self.state.device.touch.call_count, 4)

    def test_legacy_lease_cannot_be_upgraded_after_operation(self):
        request = self.request()
        legacy = copy.deepcopy(request)
        legacy["schemaVersion"] = "lakda/native-action-request/v1"
        del legacy["approvalWindow"]
        self.perform(legacy)
        request["ordinal"] = 2
        with self.assertRaisesRegex(Exception, "approval-window-mismatch"):
            self.perform(request)
        self.state.device.touch.assert_called_once()

    def test_preparation_expiry_has_no_sdk_attempt(self):
        request = self.request()
        clock = [self.now]
        def prepare(candidate):
            clock[0] += 5000
            return {"ui": {"screen": {"resolution": [100, 200]}}}
        self.state._assert_fresh_candidate.side_effect = prepare
        with patch.object(actions.clock, "wall_milliseconds", side_effect=lambda: clock[0]):
            result = self.perform(request)
        self.assertFalse(result["actionAttempted"])
        self.assertEqual(result["result"]["status"], "denied")
        self.assertEqual(result["result"]["failureSignature"], "native-identity: approval-window-expired")
        self.state.device.touch.assert_not_called()

    def test_sdk_expiry_retains_attempt_and_invalidates_lease(self):
        for operation in ("execute", "recover"):
            request = self.request()
            request["operation"] = operation
            if operation == "recover":
                request["payload"] = {"failure": {}, "context": {}}
            clock = [self.now]
            def invoked(*args):
                clock[0] += 5000
            method = self.state.device.touch if operation == "execute" else self.state.device.keyevent
            method.side_effect = invoked
            with patch.object(actions.clock, "wall_milliseconds", side_effect=lambda: clock[0]):
                result = self.perform(request)
            self.assertTrue(result["actionAttempted"])
            if operation == "execute":
                self.assertEqual(result["result"]["status"], "infrastructure_error")
            else:
                self.assertFalse(result["result"]["recovered"])
            request["ordinal"] = 2
            with self.assertRaisesRegex(Exception, "lease-unavailable"):
                self.perform(request)

    def test_monotonic_deadline_is_not_reset_by_next_request(self):
        request = self.request()
        clock = [time.monotonic()]
        with patch.object(actions.clock, "wall_milliseconds", return_value=self.now), patch.object(actions.time, "monotonic", side_effect=lambda: clock[0]):
            self.perform(request)
            clock[0] += 5
            request["ordinal"] = 2
            with self.assertRaisesRegex(Exception, "approval-window-expired"):
                self.perform(request)
        self.state.device.touch.assert_called_once()

    def test_wall_clock_reversal_within_valid_window_is_refused(self):
        request = self.request()
        clock = [self.now]
        with patch.object(actions.clock, "wall_milliseconds", side_effect=lambda: clock[0]):
            self.perform(request)
            clock[0] -= 1
            request["ordinal"] = 2
            with self.assertRaisesRegex(Exception, "approval-window-expired"):
                self.perform(request)
        self.state.device.touch.assert_called_once()
