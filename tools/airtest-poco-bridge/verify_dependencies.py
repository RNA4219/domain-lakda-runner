"""Operator venv内の依存import検証。bridge起動・device接続は行わない。"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import sys
import sysconfig
import tempfile
from dependency_lock import MAX_LOCK_BYTES, compare_packages, parse_lock


def verify_environment(lock_path):
    packages, roots, lock_digest = [], [], None
    phase = "lock-read-failed"
    try:
        with Path(lock_path).open("rb") as stream:
            content = stream.read(MAX_LOCK_BYTES + 1)
        phase = "lock-invalid"
        if len(content) <= MAX_LOCK_BYTES:
            lock_digest = "sha256:" + hashlib.sha256(content).hexdigest()
        locked = parse_lock(content)
        phase = "environment-read-failed"
        roots = sorted({str(Path(sysconfig.get_path(key)).resolve()) for key in ("purelib", "platlib")})
        packages = [{"name": dist.metadata.get("Name"), "version": dist.version}
                    for dist in importlib.metadata.distributions(path=roots)]
        dependency_check = compare_packages(locked, packages)
    except Exception as exc:
        dependency_check = {"status": "failed", "lockedPackages": None, "installedPackages": len(packages),
                            "checks": [], "excluded": [], "reason": phase, "errorType": type(exc).__name__}
    modules = ["airtest", "airtest.core.api", "airtest.core.win.win", "airtest.core.android.android",
               "airtest.core.ios.ios", "poco", "poco.drivers.android.uiautomation"]
    checks = []
    for name in modules:
        if dependency_check["status"] != "passed":
            checks.append({"module": name, "status": "not-run", "reason": "dependency-check-failed"})
            continue
        try:
            module = importlib.import_module(name)
            origin = getattr(module, "__file__", None)
            if not origin or not any(Path(origin).resolve().is_relative_to(root) for root in roots):
                checks.append({"module": name, "status": "failed", "reason": "outside-environment"})
            else:
                checks.append({"module": name, "status": "passed"})
        except Exception as exc:
            checks.append({"module": name, "status": "failed", "reason": "import-failed", "errorType": type(exc).__name__})
    return lock_digest, packages, dependency_check, checks


def save_evidence(output, result):
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, staging = tempfile.mkstemp(prefix=".lakda-dependency-", dir=output.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(result, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.link(staging, output)
    finally:
        os.unlink(staging)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lock", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    lock_digest, packages, dependency_check, checks = verify_environment(args.lock)
    result = {
        "schemaVersion": "lakda/bridge-dependency-verification/v2",
        "verifiedAt": datetime.now(timezone.utc).isoformat(),
        "pythonVersion": platform.python_version(), "platform": sys.platform, "architecture": platform.machine(),
        "lockSha256": lock_digest,
        "status": "passed" if dependency_check["status"] == "passed" and all(check["status"] == "passed" for check in checks) else "failed",
        "scope": "locked-versions-and-package-import", "deviceConnected": False,
        "environment": {"distributionSource": "interpreter-site-packages",
                        "isVirtualEnvironment": sys.prefix != sys.base_prefix,
                        "allowedUnpinnedInstallerPackages": ["pip"]},
        "packages": packages, "dependencyCheck": dependency_check,
        "imports": checks,
    }
    notification = {key: value for key, value in result.items() if key not in ("packages", "dependencyCheck")}
    notification["dependencyCheck"] = {key: value for key, value in dependency_check.items() if key != "checks"}
    try:
        save_evidence(args.out, result)
        notification["evidenceSaved"] = True
    except OSError as exc:
        notification.update(evidenceSaved=False, saveErrorType=type(exc).__name__)
    print(json.dumps(notification))
    return 0 if result["status"] == "passed" and notification["evidenceSaved"] else 1


if __name__ == "__main__":
    sys.exit(main())
