"""native-actionの接続・期限・一回実行を人工SDKで検証する。"""
import copy
import json
import threading
import time
from types import SimpleNamespace
from unittest.mock import Mock, patch
import unittest
from bridge_fixture import bridge
import test_native_identity_exchange as cases


class NativeActionTests(unittest.TestCase):
    def setUp(self):
        self.fixture = cases.IdentityExchangeTests()
        self.fixture.setUp()
        self.state = self.fixture.state
        self.exchange = self.fixture.exchange
        self.state.device.touch = Mock()
        self.state.device.keyevent = Mock()
        self.state.airtest.device = lambda: self.state.device
        self.state.airtest.touch = Mock()
        self.state.airtest.keyevent = Mock()
        self.state._assert_fresh_candidate = Mock(return_value={"ui": {"screen": {"resolution": [100, 200]}}})
        self.state.native_identity_exchange = self.exchange

    def tearDown(self):
        self.fixture.tearDown()

    def observe(self, **opening):
        session = self.fixture.open(**opening)
        return self.exchange.observe(self.fixture.observing(session), cases.ENDPOINT)

    def request(self, record=None, operation="execute", ordinal=1):
        record = record or self.observe()
        payload = {"candidate": {"candidateId": "candidate-1", "sourceFingerprint": "sha256:" + "a" * 64,
                    "actionKind": "tap", "visual": {"region": {"x": 0.1, "y": 0.2, "width": 0.2, "height": 0.2}}},
                   "context": {"runId": "fixture-run", "timeoutMs": 1000}}
        if operation == "recover":
            payload = {"failure": {}, "context": {"runId": "fixture-run", "timeoutMs": 1000}}
        return {"schemaVersion": "lakda/native-action-request/v1", "operation": operation, "ordinal": ordinal,
                "lease": {"observationId": record["observationId"], "observationDigest": cases.exchange._digest(record),
                          "connectionId": record["bridgeBinding"]["connectionId"], "challenge": record["challenge"]},
                "payload": payload}

    def perform(self, request, endpoint=cases.ENDPOINT):
        value = self.exchange.actions.perform(request, endpoint)
        self.assertNotIn(cases.RAW, json.dumps(value))
        return value

    def test_tap_and_recovery_use_observed_device_not_shared_api_and_bind_receipts(self):
        record = self.observe()
        request = self.request(record)
        result = self.perform(request)
        self.assertEqual(result["schemaVersion"], "lakda/native-action-result/v1")
        self.assertEqual(result["lease"], request["lease"])
        self.assertEqual(result["ordinal"], 1)
        self.assertEqual(result["result"]["status"], "executed")
        self.assertTrue(result["actionAttempted"])
        self.state.device.touch.assert_called_once_with((20, 60))
        recovered = self.perform(self.request(record, "recover", 2))
        self.assertTrue(recovered["result"]["recovered"])
        self.assertTrue(recovered["actionAttempted"])
        self.state.device.keyevent.assert_called_once_with("BACK")
        self.state.airtest.touch.assert_not_called()
        self.state.airtest.keyevent.assert_not_called()

    def test_duplicate_and_skipped_ordinals_never_repeat_an_action(self):
        record = self.observe()
        self.perform(self.request(record))
        for ordinal in (1, 3, 0, True):
            with self.subTest(ordinal=ordinal), self.assertRaises(cases.exchange.NativeIdentityExchangeError):
                self.perform(self.request(record, ordinal=ordinal))
        self.state.device.touch.assert_called_once()
        self.perform(self.request(record, ordinal=2))
        self.assertEqual(self.state.device.touch.call_count, 2)

    def test_unknown_shape_and_lease_binding_are_rejected_without_sdk_calls(self):
        for field, value in (("observationId", "bad"), ("observationDigest", "sha256:" + "f" * 64),
                             ("connectionId", "00000000-0000-4000-8000-000000000099"),
                             ("challenge", "00000000-0000-4000-8000-000000000099")):
            request = self.request()
            request["lease"][field] = value
            with self.subTest(field=field), self.assertRaises(cases.exchange.NativeIdentityExchangeError):
                self.perform(request)
        invalid = self.request()
        invalid["unknown"] = "private-canary"
        with self.assertRaises(cases.exchange.NativeIdentityExchangeError):
            self.perform(invalid)
        self.state.device.touch.assert_not_called()

    def test_shared_device_switch_and_connection_change_are_rejected_before_preparation(self):
        for mutate in (lambda: setattr(self.state.airtest, "device", lambda: object()),
                       lambda: setattr(self.state.device.adb, "serialno", "another-selector")):
            request = self.request()
            original_device = self.state.device
            original_selector = original_device.adb.serialno
            mutate()
            with self.assertRaises(cases.exchange.NativeIdentityExchangeError):
                self.perform(request)
            self.state._assert_fresh_candidate.assert_not_called()
            self.state.airtest.device = lambda: self.state.device
            original_device.adb.serialno = original_selector
        self.state.device.touch.assert_not_called()

    def test_expiry_and_clock_reversal_reject_before_sdk(self):
        request = self.request()
        future = time.time() + 61
        with patch.object(cases.exchange.clock, "wall_milliseconds", return_value=int(future * 1000)), self.assertRaises(cases.exchange.NativeIdentityExchangeError):
            self.perform(request)
        request = self.request()
        with patch.object(cases.exchange.clock, "wall_milliseconds", return_value=0), self.assertRaises(cases.exchange.NativeIdentityExchangeError):
            self.perform(request)
        self.state.device.touch.assert_not_called()

    def test_candidate_preparation_cannot_outlive_or_change_the_identity(self):
        request = self.request()
        self.state._assert_fresh_candidate.side_effect = lambda candidate: (setattr(self.state.device.adb, "serialno", "changed") or {"ui": {"screen": {"resolution": [100, 200]}}})
        result = self.perform(request)
        self.assertEqual(result["result"]["status"], "denied")
        self.assertFalse(result["actionAttempted"])
        self.state.device.touch.assert_not_called()
        with self.assertRaises(cases.exchange.NativeIdentityExchangeError):
            self.perform({**request, "ordinal": 2})

    def test_sdk_failure_or_post_call_change_is_not_reported_as_zero_attempts(self):
        for callback in (Mock(side_effect=RuntimeError("private-sdk-error")), lambda pos: setattr(self.state.device.adb, "serialno", "changed")):
            self.state.device.adb.serialno = "private-selector"
            request = self.request()
            self.state.device.touch.side_effect = callback
            result = self.perform(request)
            self.assertEqual(result["result"]["status"], "infrastructure_error")
            self.assertTrue(result["actionAttempted"])
            self.assertNotIn("private-sdk-error", json.dumps(result))
            with self.assertRaises(cases.exchange.NativeIdentityExchangeError):
                self.perform({**request, "ordinal": 2})

    def test_unobserved_mandatory_fields_never_create_an_action_lease(self):
        snapshot = self.fixture.provider()
        snapshot["fields"]["appBuild"] = {"status": "unavailable", "source": "unavailable", "value": None}
        self.fixture.provider.return_value = snapshot
        self.fixture.provider.side_effect = lambda **kwargs: copy.deepcopy(snapshot)
        request = self.request()
        with self.assertRaises(cases.exchange.NativeIdentityExchangeError):
            self.perform(request)
        self.state.device.touch.assert_not_called()

    def test_concurrent_requests_do_not_enter_two_sdk_operations(self):
        entered, release = threading.Event(), threading.Event()
        request = self.request()
        errors = []
        self.state.device.touch.side_effect = lambda pos: (entered.set(), release.wait(2))
        def first():
            try:
                self.perform(request)
            except Exception as error:
                errors.append(error)
        thread = threading.Thread(target=first)
        thread.start()
        try:
            self.assertTrue(entered.wait(1))
            with self.assertRaises(cases.exchange.NativeIdentityExchangeError):
                self.perform({**request, "ordinal": 2})
        finally:
            release.set()
            thread.join(timeout=2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        self.state.device.touch.assert_called_once()

    def test_candidate_denial_remains_zero_attempts_and_invalidates_the_lease(self):
        request = self.request()
        self.state._assert_fresh_candidate.side_effect = bridge.CandidateDenied("stale_candidate")
        result = self.perform(request)
        self.assertEqual(result["result"]["status"], "denied")
        self.assertFalse(result["actionAttempted"])
        with self.assertRaises(cases.exchange.NativeIdentityExchangeError):
            self.perform({**request, "ordinal": 2})

    def test_poco_target_and_agent_are_bound_before_and_after_proxy_preparation(self):
        click = Mock()
        self.state.poco = Mock(device=self.state.device, adb_client=self.state.device.adb, agent=object(), return_value=SimpleNamespace(click=click))
        self.state.templates = [{"source": "poco", "id": "fixture-button", "operatorApproved": True, "mutationKind": "none"}]
        request = self.request()
        request["payload"]["candidate"].update(actionKind="poco-tap", locatorRecipe={"value": "fixture-button"})
        self.assertEqual(self.perform(request)["result"]["status"], "executed")
        click.assert_called_once()
        request = self.request()
        request["payload"]["candidate"].update(actionKind="poco-tap", locatorRecipe={"value": "fixture-button"})
        self.state.poco.side_effect = lambda **kwargs: (setattr(self.state.poco, "adb_client", object()) or SimpleNamespace(click=click))
        result = self.perform(request)
        self.assertEqual(result["result"]["status"], "denied")
        self.assertFalse(result["actionAttempted"])
        click.assert_called_once()

    def test_candidate_preparation_is_included_in_the_monotonic_lease_deadline(self):
        clock = [time.monotonic()]
        with patch.object(cases.exchange.time, "monotonic", side_effect=lambda: clock[0]):
            request = self.request()
            def prepare(candidate):
                clock[0] += 60
                return {"ui": {"screen": {"resolution": [100, 200]}}}
            self.state._assert_fresh_candidate.side_effect = prepare
            result = self.perform(request)
        self.assertEqual(result["result"]["status"], "denied")
        self.assertFalse(result["actionAttempted"])
        self.state.device.touch.assert_not_called()

    def test_valid_leases_are_bounded_and_expired_leases_are_pruned_on_registration(self):
        for _ in range(32):
            self.observe()
        with self.assertRaisesRegex(cases.exchange.NativeIdentityExchangeError, "lease-capacity"):
            self.observe()
        self.assertEqual(len(self.exchange.actions._leases), 32)
        later = time.monotonic() + 301
        with patch.object(cases.exchange.time, "monotonic", return_value=later):
            self.observe()
        self.assertEqual(len(self.exchange.actions._leases), 1)
