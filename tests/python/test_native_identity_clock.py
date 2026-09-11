"""clockは整数変換を使い、Windowsの粗いtime.timeへfallbackしない。"""
import importlib
import time
import unittest
from unittest.mock import patch
import test_native_identity_actions as fixtures


class NativeClockTests(unittest.TestCase):
    def setUp(self):
        self.clock = importlib.import_module("native_identity_clock")

    def test_windows_filetime_is_converted_with_integer_millisecond_precision(self):
        expected = 1789048092015
        for remainder in (0, 1, 9999):
            with patch.object(self.clock.sys, "platform", "win32"), patch.object(self.clock, "_windows_filetime", return_value=116444736000000000 + expected * 10000 + remainder):
                self.assertEqual(self.clock.wall_milliseconds(), expected)

    def test_unavailable_or_invalid_windows_clock_is_not_replaced_by_coarse_time(self):
        for result in (0, -1, None):
            with patch.object(self.clock.sys, "platform", "win32"), patch.object(self.clock, "_windows_filetime", return_value=result):
                with self.assertRaisesRegex(RuntimeError, "native-clock-unavailable"):
                    self.clock.wall_milliseconds()
        with patch.object(self.clock.sys, "platform", "win32"), patch.object(self.clock, "_windows_filetime", side_effect=OSError("private-clock-error")):
            with self.assertRaisesRegex(RuntimeError, "^native-clock-unavailable$"):
                self.clock.wall_milliseconds()

    def test_other_platforms_keep_integer_nanosecond_clock(self):
        with patch.object(self.clock.sys, "platform", "linux"), patch.object(self.clock.time, "time_ns", return_value=1789048092015999999):
            self.assertEqual(self.clock.wall_milliseconds(), 1789048092015)

    def test_installed_clock_returns_a_current_integer_timestamp(self):
        observed = self.clock.wall_milliseconds()
        self.assertIs(type(observed), int)
        self.assertLess(abs(observed - int(time.time() * 1000)), 1000)
