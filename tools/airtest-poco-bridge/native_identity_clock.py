"""native protocol用のUTC時計。期限の経過時間は別の単調時計で扱う。"""
import ctypes
import sys
import time

_EPOCH_FILETIME = 116444736000000000
_precise = None


class _FileTime(ctypes.Structure):
    _fields_ = [("low", ctypes.c_uint32), ("high", ctypes.c_uint32)]


def _windows_filetime():
    global _precise
    if _precise is None:
        function = ctypes.WinDLL("kernel32.dll", use_last_error=True).GetSystemTimePreciseAsFileTime
        function.argtypes = [ctypes.POINTER(_FileTime)]
        function.restype = None
        _precise = function
    value = _FileTime()
    _precise(ctypes.byref(value))
    return (value.high << 32) | value.low


def wall_milliseconds():
    try:
        if sys.platform == "win32":
            ticks = _windows_filetime()
            if type(ticks) is not int or ticks < _EPOCH_FILETIME:
                raise ValueError()
            return (ticks - _EPOCH_FILETIME) // 10000
        return time.time_ns() // 1000000
    except Exception:
        raise RuntimeError("native-clock-unavailable") from None
