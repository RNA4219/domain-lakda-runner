"""解決済みhash lockとinterpreterの導入distributionを照合する。"""
import re


MAX_LOCK_BYTES = 1024 * 1024
NAME = r"[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?"
VERSION = r"[0-9][A-Za-z0-9.!+_-]*"
REQUIREMENT = re.compile(rf"({NAME})==({VERSION})(?:\s+--hash=sha256:[0-9a-fA-F]{{64}})+")


def canonical_name(name):
    if not isinstance(name, str) or not re.fullmatch(NAME, name):
        raise ValueError("invalid-package-name")
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_lock(content):
    if len(content) > MAX_LOCK_BYTES:
        raise ValueError("lock-too-large")
    text = content.decode("utf-8")
    locked, pending = {}, []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        continued = line.endswith("\\")
        pending.append(line[:-1].rstrip() if continued else line)
        if continued:
            continue
        match = REQUIREMENT.fullmatch(" ".join(pending))
        if not match:
            raise ValueError("unsupported-lock-entry")
        name = canonical_name(match[1])
        if name in locked:
            raise ValueError("duplicate-lock-package")
        locked[name] = match[2]
        pending = []
    if pending or not locked:
        raise ValueError("incomplete-or-empty-lock")
    return locked


def compare_packages(locked, packages):
    installed, checks, excluded = {}, [], []
    for package in packages:
        try:
            name = canonical_name(package["name"])
            version = package["version"]
            if not isinstance(version, str) or not re.fullmatch(VERSION, version):
                raise ValueError("invalid-package-version")
            installed.setdefault(name, []).append(version)
        except (KeyError, TypeError, ValueError):
            checks.append({"name": None, "expectedVersion": None, "installedVersions": [],
                           "status": "failed", "reason": "invalid-distribution-metadata"})
    for name in sorted(locked.keys() | installed.keys()):
        versions = sorted(installed.get(name, []))
        expected = locked.get(name)
        if len(versions) > 1:
            reason = "ambiguous-distribution"
        elif not versions:
            reason = "missing"
        elif expected is None:
            if name == "pip":
                excluded.append({"name": name, "version": versions[0]})
                continue
            reason = "unexpected-package"
        else:
            reason = "match" if versions[0] == expected else "version-mismatch"
        checks.append({"name": name, "expectedVersion": expected, "installedVersions": versions,
                       "status": "passed" if reason == "match" else "failed", "reason": reason})
    return {"status": "passed" if all(row["status"] == "passed" for row in checks) else "failed",
            "lockedPackages": len(locked), "installedPackages": len(packages), "checks": checks,
            "excluded": excluded}
