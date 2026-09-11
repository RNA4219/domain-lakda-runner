#!/usr/bin/env python3
"""Lakda operator-managed Airtest/Poco loopback bridge.

The bridge is intentionally a reference implementation: Lakda never starts it.
It binds to 127.0.0.1, accepts only JSON, and writes captures only below the
operator-selected staging root. Airtest/Poco are optional imports until the
operator actually connects a target device.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import mimetypes
import os
import shutil
import threading
from native_identity_capture_video import NativeCaptureVideo
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from native_identity import observe_android_identity
from native_identity_exchange import NativeIdentityExchange, NativeIdentityExchangeError

MAX_JSON_BYTES = 1_048_576
SCHEMA = "lakda/adaptive-contracts/v1"
MAX_CANDIDATE_REGISTRY = 512


class CandidateDenied(RuntimeError):
    """A candidate failed a deterministic freshness/safety check."""

    def __init__(self, signature: str) -> None:
        super().__init__(signature)
        self.signature = signature


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def digest_json(value: Any) -> str:
    return digest_bytes(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


def reject_json_constant(value: str) -> None:
    raise ValueError("non-finite JSON number")


class BridgeState:
    def __init__(self, args: argparse.Namespace) -> None:
        self.platform = args.platform
        self.target_revision = args.target_revision
        self.app_id = args.app_id
        self.app_revision = args.app_revision or args.target_revision
        self.platform_version = args.platform_version
        self.serial_digest = args.serial_digest
        self.device_alias_digest = args.device_alias_digest
        self.surface = args.surface or self.platform
        self.output_dir = Path(args.output_dir).resolve()
        self.allowed_staging_root = Path(args.allowed_staging_root).resolve()
        self.template_manifest_path = Path(args.templates).resolve() if args.templates else None
        self.template_root = Path(args.templates_root).resolve() if args.templates_root else (self.template_manifest_path.parent if self.template_manifest_path else None)
        self.templates = self._read_templates(self.template_manifest_path, self.template_root)
        self.template_corpus_digest = f"sha256:{digest_bytes(self.template_manifest_path.read_bytes())}" if self.template_manifest_path else None
        self.device: Any = None
        self.poco: Any = None
        self.airtest: Any = None
        self.runtime_versions: dict[str, str] = {}
        self._recording: dict[str, Any] = {}
        self._recording_lock = threading.Lock()
        self._capture_command_lock = threading.Lock()
        self._candidate_registry: dict[str, dict[str, Any]] = {}
        self._candidate_registry_lock = threading.Lock()
        self.native_identity_exchange = NativeIdentityExchange(self)
        self._load_runtime(args.device_uri)

    def _remember_candidate(self, candidate: dict[str, Any], adapter_data_ref: str | None) -> None:
        candidate_id = candidate.get("candidateId")
        if not isinstance(candidate_id, str) or not candidate_id or not isinstance(adapter_data_ref, str) or not adapter_data_ref:
            return
        entry = {
            "sourceFingerprint": candidate.get("sourceFingerprint"),
            "adapterDataRef": adapter_data_ref,
            "targetRef": candidate.get("targetRef"),
            "actionKind": candidate.get("actionKind"),
            "locatorRecipe": candidate.get("locatorRecipe"),
            "mutationKind": candidate.get("mutationKind"),
            "visual": candidate.get("visual"),
        }
        with self._candidate_registry_lock:
            existing = self._candidate_registry.get(candidate_id)
            if existing is not None:
                # Re-discovering the exact same binding is idempotent.  A
                # reused candidate id with a different binding is unsafe:
                # retain an explicit collision tombstone and reject it at
                # execution rather than silently replacing the first entry.
                if existing.get("collision") is True:
                    return
                if existing == entry:
                    return
                self._candidate_registry[candidate_id] = {"collision": True}
                return
            self._candidate_registry[candidate_id] = entry
            while len(self._candidate_registry) > MAX_CANDIDATE_REGISTRY:
                self._candidate_registry.pop(next(iter(self._candidate_registry)))

    def _candidate_entry(self, candidate_id: Any) -> dict[str, Any] | None:
        if not isinstance(candidate_id, str) or not candidate_id:
            return None
        with self._candidate_registry_lock:
            entry = self._candidate_registry.get(candidate_id)
            return dict(entry) if entry is not None else None

    @staticmethod
    def _read_templates(path: Path | None, template_root: Path | None) -> list[dict[str, Any]]:
        """Read a corpus with an explicit, confined path base.

        The manifest is the default base directory.  ``--templates-root`` can
        override it, but every image path must remain relative to that root
        and point at an existing regular file.  This deliberately rejects the
        repository example until an operator replaces its placeholder corpus.
        """
        if not path:
            return []
        if template_root is None or not template_root.is_dir():
            raise ValueError("template root must be an existing directory")
        value = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(value, dict):
            if value.get("operatorReplacementRequired") is True:
                raise ValueError("template corpus is a non-executable example; operator must replace the corpus and set operatorReplacementRequired=false")
            entries = value.get("templates")
            poco_entries = value.get("poco", [])
            if not isinstance(entries, list) or not isinstance(poco_entries, list):
                raise ValueError("template corpus templates and poco fields must be arrays")
            value = [*entries, *[{**item, "source": "poco"} if isinstance(item, dict) else item for item in poco_entries]]
        if not isinstance(value, list):
            raise ValueError("templates must be a JSON array or a template corpus object")
        normalized: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        root = template_root.resolve()
        for item in value:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"]:
                raise ValueError("template entries require a non-empty id")
            if item["id"] in seen_ids:
                raise ValueError(f"template/poco id is duplicated: {item['id']}")
            seen_ids.add(item["id"])
            source = str(item.get("source", "airtest-template"))
            if source == "poco":
                if item.get("operatorApproved") is not True or item.get("mutationKind") != "none":
                    # Keep unsafe/unapproved entries out of the candidate set;
                    # discover_candidates will expose them as coverage debt.
                    normalized.append({**item, "source": "poco"})
                    continue
                normalized.append({**item, "source": "poco"})
                continue
            raw_path = item.get("path")
            if not isinstance(raw_path, str) or not raw_path or Path(raw_path).is_absolute():
                raise ValueError(f"template {item['id']} path must be relative to template root")
            confidence = item.get("confidence", 0.9)
            if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not math.isfinite(float(confidence)) or not 0 < float(confidence) <= 1:
                raise ValueError(f"template {item['id']} confidence must be a finite number in (0, 1]")
            resolved = (root / raw_path).resolve()
            try:
                common = os.path.commonpath([str(resolved), str(root)])
            except ValueError as exc:
                raise ValueError(f"template {item['id']} path is outside template root") from exc
            if common != str(root) or not resolved.is_file():
                raise ValueError(f"template {item['id']} path does not exist below template root: {raw_path}")
            declared_digest = item.get("sha256")
            if not isinstance(declared_digest, str) or len(declared_digest) != 71 or not declared_digest.startswith("sha256:") or any(character not in "0123456789abcdef" for character in declared_digest[7:]):
                raise ValueError(f"template {item['id']} requires sha256: plus a 64-character lowercase hex digest")
            actual_digest = f"sha256:{digest_bytes(resolved.read_bytes())}"
            if actual_digest != declared_digest:
                raise ValueError(f"template {item['id']} bytes do not match declared sha256")
            normalized.append({**item, "source": "airtest-template", "path": str(resolved), "sha256": actual_digest, "confidence": float(confidence)})
        return normalized

    def _load_runtime(self, device_uri: str | None) -> None:
        try:
            from airtest.core import api as airtest_api  # type: ignore
            from airtest.core.cv import Template  # type: ignore
            self.airtest = airtest_api
            self.Template = Template
            try:
                import importlib.metadata as metadata
                self.runtime_versions["airtestVersion"] = metadata.version("airtest")
                self.runtime_versions["pocoVersion"] = metadata.version("pocoui")
            except Exception:
                pass
            if device_uri:
                self.device = airtest_api.connect_device(device_uri)
            if self.device is not None:
                try:
                    from poco import Poco  # type: ignore
                    self.poco = Poco(self.device)
                except Exception:
                    self.poco = None
        except Exception:
            # Capability handshake will advertise unavailable runtime capabilities.
            self.airtest = None

    @property
    def video_supported(self) -> bool:
        return self._video_backend() is not None

    def _video_backend(self):
        if self.platform != "android" or self.airtest is None or self.device is None:
            return None
        device_methods = tuple(getattr(self.device, name, None) for name in ("start_recording", "stop_recording"))
        # Airtest 1.3.5 exposes Android recording on the connected device.
        # Retain the legacy injected API only when the device has neither method.
        if any(method is not None for method in device_methods):
            methods, extension = device_methods, "mp4"
        else:
            methods = tuple(getattr(self.airtest, name, None) for name in ("start_recording", "stop_recording"))
            extension = "webm"
        return (*methods, extension) if all(callable(method) for method in methods) else None

    def capabilities(self) -> dict[str, Any]:
        connected = self.device is not None and self.airtest is not None
        display: dict[str, Any] = {"surface": self.surface}
        if connected:
            width, height = self._resolution()
            display = {"width": width, "height": height, "orientation": "portrait" if height >= width else "landscape", "surface": self.surface}
        observation = ["screen", "template-match", "candidate-discovery"] if connected else []
        actions = ["tap"] if connected else []
        if connected and ((self.platform == "android" and callable(getattr(self.airtest, "keyevent", None))) or callable(getattr(self.device, "keyevent", None)) or callable(getattr(self.device, "back", None))):
            actions.append("back")
        if self.poco is not None:
            observation += ["poco", "hierarchy"]
            actions += ["poco-tap"]
        evidence = ["screenshot", "sampled-frames/v1"] if connected else []
        if self.video_supported:
            evidence.append("video")
        return {
            "schemaVersion": SCHEMA,
            "adapterId": "airtest-poco",
            "revision": "reference-bridge/v1",
            "targetRevision": self.target_revision,
            "platform": self.platform,
            "targetKinds": ["device", "surface"],
            "actionKinds": actions,
            "observationCapabilities": observation,
            "evidenceCapabilities": evidence,
            "recoveryStrategies": ["backtrack", "back"] if connected else [],
            "liveness": {"connected": connected, "responsive": connected},
            "runtime": dict(self.runtime_versions),
            "device": {key: value for key, value in {"appId": self.app_id, "appRevision": self.app_revision, "platformVersion": self.platform_version, "serialDigest": self.serial_digest, "deviceAliasDigest": self.device_alias_digest}.items() if value},
            "display": display,
            **({"templateCorpusDigest": self.template_corpus_digest} if self.template_corpus_digest else {}),
        }

    def _require_device(self) -> Any:
        if self.device is None or self.airtest is None:
            raise RuntimeError("Airtest device is not connected; start the bridge with --device-uri")
        return self.device

    def native_identity_fields(self, timeout_ms: int = 5000) -> dict[str, Any]:
        """Collect SDK facts for the versioned identity flow; this is not an approval."""
        if self.platform != "android":
            raise ValueError("native-identity: provider-unavailable")
        device, runtime = self.device, self.airtest
        result = observe_android_identity(device if runtime is not None else None, self.app_id, dict(self.runtime_versions), timeout_ms)
        if self.device is not device or self.airtest is not runtime:
            raise ValueError("native-identity: connection-changed")
        return result

    def _resolution(self) -> tuple[int, int]:
        device = self._require_device()
        value = getattr(device, "get_current_resolution", lambda: (1, 1))()
        if isinstance(value, (tuple, list)) and len(value) >= 2:
            return max(1, int(value[0])), max(1, int(value[1]))
        return 1, 1

    def _safe_staging(self, value: str | None, run_id: str) -> Path:
        requested = Path(value or (self.output_dir / run_id)).resolve()
        try:
            common = os.path.commonpath([str(requested), str(self.allowed_staging_root)])
        except ValueError as exc:
            raise RuntimeError("capture staging path is outside the allowed root") from exc
        if common != str(self.allowed_staging_root):
            raise RuntimeError("capture staging path is outside the allowed root")
        requested.mkdir(parents=True, exist_ok=True)
        return requested

    def _safe_artifact_path(self, staging: Path, relative: str) -> Path:
        """Resolve a relative artifact path before any write takes place."""
        relative_path = Path(relative)
        if not relative or relative_path.is_absolute() or any(part == ".." for part in relative_path.parts):
            raise RuntimeError("capture artifact path must be relative to staging")
        root = staging.resolve()
        candidate = root / relative_path
        try:
            resolved = candidate.resolve()
            resolved.relative_to(root)
        except (OSError, ValueError) as exc:
            raise RuntimeError("capture artifact path is outside its staging root") from exc
        current = root
        for index, part in enumerate(relative_path.parts):
            current = current / part
            if current.is_symlink():
                raise RuntimeError("capture artifact path contains a symlink")
            if index < len(relative_path.parts) - 1 and current.exists() and not current.is_dir():
                raise RuntimeError("capture artifact parent is not a directory")
        return candidate

    def _artifact_ref(self, path: Path, staging: Path) -> dict[str, Any]:
        try:
            relative = path.resolve().relative_to(staging.resolve()).as_posix()
        except ValueError as exc:
            raise RuntimeError("capture artifact is outside its staging root") from exc
        data = path.read_bytes()
        return {"schemaVersion": SCHEMA, "artifactId": f"airtest:{path.name}", "path": relative, "sha256": digest_bytes(data), "size": len(data), "classification": "internal", "redactionStatus": "pending", "securityStatus": "not_applicable"}

    def _validated_video_artifact(self, active: dict[str, Any]) -> dict[str, Any]:
        path = active.get("path")
        staging = active.get("staging")
        if not isinstance(path, Path) or not isinstance(staging, Path) or path.is_symlink() or not path.is_file():
            raise RuntimeError("video artifact is missing")
        try:
            size = path.stat().st_size
            max_bytes = int(active.get("maxBytes", 1_073_741_824))
        except (OSError, TypeError, ValueError) as exc:
            raise RuntimeError("video artifact metadata is invalid") from exc
        if size <= 0:
            raise RuntimeError("video artifact is empty")
        if max_bytes <= 0 or size > max_bytes:
            raise RuntimeError("video artifact exceeds maxBytes")
        return self._artifact_ref(path, staging)

    def _validated_frame_capture(self, active: dict[str, Any]) -> bool:
        """Sealing requires the exact frames observed by the sampler."""
        staging = active["staging"]
        recorded = active.get("artifacts", [])
        if len(recorded) != active.get("frames"):
            return False
        try:
            directory = self._safe_artifact_path(staging, "artifacts/frames")
            if not directory.is_dir() or len(list(directory.iterdir())) != len(recorded):
                return False
            for expected in recorded:
                path = self._safe_artifact_path(staging, expected["path"])
                if path.is_symlink() or not path.is_file():
                    return False
                actual = self._artifact_ref(path, staging)
                if actual["sha256"] != expected["sha256"] or actual["size"] != expected["size"]:
                    return False
            return sum(item["size"] for item in recorded) == active.get("bytes")
        except (OSError, RuntimeError, KeyError):
            return False

    def _snapshot(self, staging: Path, name: str = "screen.png", identity_guard=None) -> Path:
        target = self._safe_artifact_path(staging, f"artifacts/{name}")
        target.parent.mkdir(parents=True, exist_ok=True)
        self._require_device()
        if identity_guard is None:
            self.airtest.snapshot(filename=str(target))
        else:
            identity_guard.snapshot(target)
        return target

    def _poco_nodes(self) -> list[dict[str, Any]]:
        """Poco hierarchyから、操作に必要な最小の公開metadataだけを抽出する。"""
        if self.poco is None:
            return []
        try:
            root = self.poco.freeze() if callable(getattr(self.poco, "freeze", None)) else {}
        except Exception:
            return []
        nodes: list[dict[str, Any]] = []

        def walk(value: Any, path: str = "0") -> None:
            if not isinstance(value, dict):
                return
            attrs = value.get("attrs") if isinstance(value.get("attrs"), dict) else value
            if not isinstance(attrs, dict):
                attrs = {}
            node_id = attrs.get("resourceName") or attrs.get("name") or attrs.get("id") or path
            pos = attrs.get("pos") or attrs.get("position")
            size = attrs.get("size") or attrs.get("bounds")
            if isinstance(pos, (list, tuple)) and len(pos) >= 2 and isinstance(size, (list, tuple)) and len(size) >= 2:
                try:
                    x, y, width, height = float(pos[0]), float(pos[1]), float(size[0]), float(size[1])
                    clickable = attrs.get("clickable") is True and attrs.get("enabled") is not False
                    if clickable and width > 0 and height > 0 and 0 <= x <= 1 and 0 <= y <= 1 and x + width <= 1 and y + height <= 1:
                        nodes.append({"id": str(node_id), "region": {"x": x, "y": y, "width": width, "height": height}, "clickable": True})
                except (TypeError, ValueError):
                    pass
            children = value.get("children")
            if isinstance(children, list):
                for index, child in enumerate(children):
                    walk(child, f"{path}.{index}")

        walk(root)
        return nodes[:100]

    def observe(self, request: dict[str, Any]) -> dict[str, Any]:
        target = request.get("target") or {"targetId": "device-1", "kind": "device"}
        screen: dict[str, Any] = {"resolution": self._resolution(), "templates": [], "poco": False}
        if self.device is not None and self.airtest is not None:
            for template in self.templates:
                if template.get("source", "airtest-template") != "airtest-template":
                    continue
                path = template.get("path")
                if not isinstance(path, str):
                    continue
                try:
                    match = self.airtest.exists(self.Template(path, threshold=float(template.get("confidence", 0.9))))
                except Exception:
                    match = None
                if match:
                    screen["templates"].append({"id": template["id"], "match": list(match) if isinstance(match, (tuple, list)) else match})
            screen["poco"] = self.poco is not None
            if self.poco is not None:
                screen["pocoNodes"] = self._poco_nodes()
        stable_screen = json.dumps(screen, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return {
            "schemaVersion": SCHEMA, "observationId": f"airtest-observation-{uuid.uuid4().hex[:12]}", "observedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "targetRef": target, "completeness": "complete" if self.device is not None else "unavailable", "ui": {"screen": screen}, "forms": [], "dialogs": [],
            "topology": {"activeTargetId": target.get("targetId")}, "obligations": {}, "provenance": {"adapterId": "airtest-poco", "runtime": "operator-bridge", "capabilityRevision": "reference-bridge/v1"},
            "adapterDataRef": f"airtest-screen:{digest_bytes(stable_screen.encode('utf-8'))}"
        }

    def discover_candidates(self, request: dict[str, Any]) -> dict[str, Any]:
        observation = request.get("observation") or {}
        fingerprint = request.get("sourceFingerprint") or observation.get("adapterDataRef")
        if not isinstance(fingerprint, str) or not fingerprint:
            return {"candidates": [], "coverageDebt": []}
        adapter_data_ref = observation.get("adapterDataRef")
        screen = ((observation.get("ui") or {}).get("screen") or {})
        matches = {item.get("id"): item for item in screen.get("templates", []) if isinstance(item, dict)}
        width, height = self._resolution() if self.device is not None else (1, 1)
        candidates: list[dict[str, Any]] = []
        debt: list[dict[str, Any]] = []
        for template in self.templates:
            if template.get("source", "airtest-template") != "airtest-template":
                continue
            if template.get("id") not in matches:
                continue
            match = matches[template["id"]].get("match")
            if isinstance(match, (list, tuple)) and len(match) >= 2:
                x, y = float(match[0]), float(match[1])
            else:
                continue
            region = {"x": x / width - 0.05, "y": y / height - 0.05, "width": 0.1, "height": 0.1}
            if region["x"] < 0 or region["y"] < 0 or region["x"] + region["width"] > 1 or region["y"] + region["height"] > 1:
                continue
            mutation = str(template.get("mutationKind", "unknown"))
            candidate_id = f"template:{template['id']}:{digest_json({'fingerprint': fingerprint, 'region': region, 'surface': self.platform})[:16]}"
            candidate = {
                "schemaVersion": SCHEMA, "candidateId": candidate_id, "adapterId": "airtest-poco", "targetRef": observation["targetRef"], "sourceFingerprint": fingerprint,
                "actionKind": template.get("actionKind", "tap"), "locatorRecipe": {"strategy": "image", "value": str(template["id"])}, "generatedBy": {"ruleId": "airtest-template", "observationId": observation["observationId"], "reason": "template-match"}, "risk": {"weight": float(template.get("risk", 1))}, "mutationKind": mutation,
                "visual": {"source": "airtest-template", "confidence": float(template.get("confidence", 0.9)), "region": region, "requiredCapabilities": ["screen", "template-match"], "identity": {"resolution": f"{width}x{height}", "orientation": "portrait" if height >= width else "landscape", "surface": self.surface}}
            }
            candidates.append(candidate)
            self._remember_candidate(candidate, adapter_data_ref if isinstance(adapter_data_ref, str) else None)
        poco_permissions = {
            str(item.get("id")): item
            for item in self.templates
            if item.get("source") == "poco"
        }
        if self.poco is not None and screen.get("poco") is True:
            poco_nodes = [node for node in screen.get("pocoNodes", []) if isinstance(node, dict) and isinstance(node.get("id"), str) and isinstance(node.get("region"), dict)]
            poco_counts: dict[str, int] = {}
            for node in poco_nodes:
                poco_counts[node["id"]] = poco_counts.get(node["id"], 0) + 1
            ambiguous_reported: set[str] = set()
            for node in screen.get("pocoNodes", []):
                if not isinstance(node, dict) or not isinstance(node.get("id"), str) or not isinstance(node.get("region"), dict):
                    continue
                region = node["region"]
                if poco_counts.get(node["id"], 0) > 1:
                    if node["id"] not in ambiguous_reported:
                        debt.append({"schemaVersion": "lakda-coverage-debt/v1", "debtId": f"poco-ambiguous-{digest_json({'fingerprint': fingerprint, 'node': node['id']})[:20]}", "reason": "ambiguous-locator", "actionKind": "poco-tap", "nameDigest": f"sha256:{digest_json(node['id'])}", "scope": "ambiguous", "targetFingerprint": fingerprint})
                        ambiguous_reported.add(node["id"])
                    continue
                permission = poco_permissions.get(node["id"])
                if permission is None or permission.get("operatorApproved") is not True or permission.get("mutationKind") != "none":
                    # Do not expose a raw semantic label in public debt; the
                    # digest lets an operator correlate it with their corpus.
                    continue
                candidate_id = f"poco:{node['id']}:{digest_json({'fingerprint': fingerprint, 'region': region, 'surface': self.surface})[:16]}"
                candidate = {
                    "schemaVersion": SCHEMA, "candidateId": candidate_id, "adapterId": "airtest-poco", "targetRef": observation["targetRef"], "sourceFingerprint": fingerprint,
                    "actionKind": "poco-tap", "locatorRecipe": {"strategy": "text", "value": node["id"]}, "generatedBy": {"ruleId": "poco-hierarchy-operator-allowlist", "observationId": observation["observationId"], "reason": "poco-clickable-operator-approved"}, "risk": {"weight": float(permission.get("risk", 1))}, "mutationKind": "none", "mutationClassification": {"source": "action-contract", "ruleId": "operator-poco-allowlist", "actionId": node["id"]},
                    "visual": {"source": "poco", "confidence": 1.0, "region": region, "requiredCapabilities": ["screen", "poco", "hierarchy"], "identity": {"resolution": f"{width}x{height}", "orientation": "portrait" if height >= width else "landscape", "surface": self.surface}}
                }
                candidates.append(candidate)
                self._remember_candidate(candidate, adapter_data_ref if isinstance(adapter_data_ref, str) else None)
        if self.poco is not None and screen.get("poco") is True:
            for node in screen.get("pocoNodes", []):
                if not isinstance(node, dict) or not isinstance(node.get("id"), str):
                    continue
                if poco_counts.get(node["id"], 0) > 1:
                    continue
                permission = poco_permissions.get(node["id"])
                if permission is None or permission.get("operatorApproved") is not True or permission.get("mutationKind") != "none":
                    debt.append({"schemaVersion": "lakda-coverage-debt/v1", "debtId": f"poco-unapproved-{digest_json({'fingerprint': fingerprint, 'node': node['id']})[:20]}", "reason": "unsupported-control", "actionKind": "poco-tap", "nameDigest": f"sha256:{digest_json(node['id'])}", "scope": "unavailable", "targetFingerprint": fingerprint})
        if not candidates and not debt:
            debt.append({"schemaVersion": "lakda-coverage-debt/v1", "debtId": f"unknown-screen-{observation['observationId']}", "reason": "unknown-screen", "actionKind": "visual-observation", "scope": "unavailable", "targetFingerprint": fingerprint})
        return {"candidates": candidates, "coverageDebt": debt}

    def generate_candidates(self, request: dict[str, Any]) -> list[dict[str, Any]]:
        return self.discover_candidates({"observation": request.get("observation", {})})["candidates"]

    @staticmethod
    def _observation_resolution(observation: dict[str, Any]) -> tuple[int, int]:
        screen = ((observation.get("ui") or {}).get("screen") or {})
        resolution = screen.get("resolution")
        if not isinstance(resolution, (list, tuple)) or len(resolution) < 2:
            raise CandidateDenied("stale_candidate")
        try:
            width, height = int(resolution[0]), int(resolution[1])
        except (TypeError, ValueError) as exc:
            raise CandidateDenied("stale_candidate") from exc
        if width <= 0 or height <= 0:
            raise CandidateDenied("stale_candidate")
        return width, height

    def _assert_fresh_candidate(self, candidate: dict[str, Any]) -> dict[str, Any]:
        entry = self._candidate_entry(candidate.get("candidateId"))
        if entry is None:
            raise CandidateDenied("stale_candidate")
        if entry.get("collision") is True:
            raise CandidateDenied("candidate_id_collision")
        if candidate.get("mutationKind") != entry.get("mutationKind"):
            raise CandidateDenied("mutation_not_allowed")
        if candidate.get("mutationKind") != "none" or entry.get("mutationKind") != "none":
            raise CandidateDenied("mutation_not_allowed")
        if candidate.get("sourceFingerprint") != entry.get("sourceFingerprint"):
            raise CandidateDenied("stale_candidate")
        if candidate.get("actionKind") != entry.get("actionKind") or candidate.get("locatorRecipe") != entry.get("locatorRecipe") or candidate.get("targetRef") != entry.get("targetRef"):
            raise CandidateDenied("stale_candidate")
        if candidate.get("visual") != entry.get("visual"):
            raise CandidateDenied("stale_candidate")

        current_observation = self.observe({"target": candidate.get("targetRef"), "context": {}})
        if current_observation.get("adapterDataRef") != entry.get("adapterDataRef"):
            raise CandidateDenied("stale_candidate")
        visual = entry.get("visual")
        if not isinstance(visual, dict):
            return current_observation

        width, height = self._observation_resolution(current_observation)
        expected_identity = visual.get("identity")
        actual_identity = {"resolution": f"{width}x{height}", "orientation": "portrait" if height >= width else "landscape", "surface": self.surface}
        if not isinstance(expected_identity, dict) or any(expected_identity.get(key) != value for key, value in actual_identity.items()):
            raise CandidateDenied("stale_candidate")
        capabilities = self.capabilities()
        capability_display = capabilities.get("display") or {}
        if any(capability_display.get(key) != value for key, value in actual_identity.items()):
            raise CandidateDenied("stale_candidate")
        required_capabilities = visual.get("requiredCapabilities", [])
        available_capabilities = set(capabilities.get("observationCapabilities", [])) | set(capabilities.get("actionKinds", []))
        if not isinstance(required_capabilities, list) or any(capability not in available_capabilities for capability in required_capabilities):
            raise CandidateDenied("stale_candidate")

        screen = ((current_observation.get("ui") or {}).get("screen") or {})
        locator_value = str((entry.get("locatorRecipe") or {}).get("value", ""))
        current_region: dict[str, Any] | None = None
        if visual.get("source") == "airtest-template":
            match = next((item.get("match") for item in screen.get("templates", []) if isinstance(item, dict) and item.get("id") == locator_value), None)
            if not isinstance(match, (list, tuple)) or len(match) < 2:
                raise CandidateDenied("stale_candidate")
            try:
                x, y = float(match[0]), float(match[1])
            except (TypeError, ValueError) as exc:
                raise CandidateDenied("stale_candidate") from exc
            current_region = {"x": x / width - 0.05, "y": y / height - 0.05, "width": 0.1, "height": 0.1}
        elif visual.get("source") == "poco":
            nodes = [node for node in screen.get("pocoNodes", []) if isinstance(node, dict) and node.get("id") == locator_value and isinstance(node.get("region"), dict)]
            if len(nodes) != 1:
                raise CandidateDenied("stale_candidate")
            current_region = nodes[0]["region"]
            permission = next((item for item in self.templates if item.get("source") == "poco" and item.get("id") == locator_value), None)
            if permission is None or permission.get("operatorApproved") is not True or permission.get("mutationKind") != "none" or entry.get("mutationKind") != "none":
                raise CandidateDenied("mutation_not_allowed")
        if current_region is None or current_region != visual.get("region"):
            raise CandidateDenied("stale_candidate")
        return current_observation

    def execute(self, request: dict[str, Any], identity_guard: Any = None) -> dict[str, Any]:
        candidate = request.get("candidate") or {}
        started = time.time()
        status = "executed"
        reason: str | None = None
        try:
            self._require_device()
            if identity_guard is not None:
                identity_guard.check()
            current_observation = self._assert_fresh_candidate(candidate)
            if candidate.get("actionKind") in ("tap", "poco-tap"):
                visual = candidate.get("visual") or {}
                region = visual.get("region") or {}
                if not all(isinstance(region.get(key), (int, float)) for key in ("x", "y", "width", "height")):
                    raise RuntimeError("visual region is required for tap")
                if region["x"] < 0 or region["y"] < 0 or region["width"] <= 0 or region["height"] <= 0 or region["x"] + region["width"] > 1 or region["y"] + region["height"] > 1:
                    raise RuntimeError("visual region is outside normalized bounds")
                template_id = str((candidate.get("locatorRecipe") or {}).get("value", ""))
                if candidate.get("actionKind") == "poco-tap":
                    permission = next((item for item in self.templates if item.get("source") == "poco" and item.get("id") == template_id), None)
                    if permission is None or permission.get("operatorApproved") is not True or permission.get("mutationKind") != "none":
                        raise CandidateDenied("mutation_not_allowed")
                    if self.poco is None:
                        raise RuntimeError("Poco hierarchy is unavailable")
                    if identity_guard is not None:
                        identity_guard.poco_click(template_id)
                    else:
                        self.poco(name=template_id).click()
                else:
                    width, height = self._observation_resolution(current_observation)
                    position = (int((float(region["x"]) + float(region["width"]) / 2) * width), int((float(region["y"]) + float(region["height"]) / 2) * height))
                    if identity_guard is not None:
                        identity_guard.touch(position)
                    else:
                        self.airtest.touch(position)
            elif candidate.get("actionKind") == "back":
                if identity_guard is not None:
                    identity_guard.back()
                elif self.platform == "android" and callable(getattr(self.airtest, "keyevent", None)):
                    self.airtest.keyevent("BACK")
                elif callable(getattr(self.device, "back", None)):
                    self.device.back()
                else:
                    raise RuntimeError("platform-specific back capability is unavailable")
            else:
                status, reason = "unsupported", "reference bridge supports tap and back in MVP"
        except CandidateDenied as exc:
            status, reason = "denied", exc.signature
        except Exception as exc:
            if identity_guard is not None and isinstance(exc, identity_guard.actions.error_type):
                status, reason = "infrastructure_error" if identity_guard.attempted else "denied", exc.code
            else:
                status, reason = "infrastructure_error", type(exc).__name__
        elapsed = max(1, int((time.time() - started) * 1000))
        result: dict[str, Any] = {"schemaVersion": SCHEMA, "executionId": f"airtest-execution-{uuid.uuid4().hex[:12]}", "candidateId": candidate.get("candidateId", "unknown"), "preFingerprint": candidate.get("sourceFingerprint", ""), "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()), "endedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()), "status": status, "recoveryStatus": "not_required" if status == "executed" else "not_attempted", "targetChanges": [], "settleResult": {"policyVersion": "settle/v1", "status": "settled" if status == "executed" else "aborted", "elapsedMs": elapsed, "reasons": [] if status == "executed" else [reason or status]}, "evidenceRefs": []}
        if reason:
            result["failureSignature"] = reason
        return result

    def recover(self, request: dict[str, Any], identity_guard: Any = None) -> dict[str, Any]:
        try:
            if self.device is not None and self.airtest is not None:
                if identity_guard is not None:
                    identity_guard.back()
                elif self.platform == "android" and callable(getattr(self.airtest, "keyevent", None)):
                    self.airtest.keyevent("BACK")
                elif callable(getattr(self.device, "back", None)):
                    self.device.back()
                else:
                    return {"recovered": False, "strategy": "back", "evidenceRefs": []}
                return {"recovered": True, "strategy": "back", "evidenceRefs": []}
        except Exception:
            pass
        return {"recovered": False, "strategy": "back", "evidenceRefs": []}

    def capture_evidence(self, request: dict[str, Any], identity_guard=None) -> list[dict[str, Any]]:
        staging = self._safe_staging(request.get("request", {}).get("stagingDir"), request.get("request", {}).get("runId", "run"))
        refs: list[dict[str, Any]] = []
        if "screenshot" in request.get("request", {}).get("kinds", []):
            name = f"screenshots/failure-{uuid.uuid4().hex[:12]}.png"
            path = self._snapshot(staging, name, identity_guard=identity_guard) if identity_guard else self._snapshot(staging, name)
            refs.append(self._artifact_ref(path, staging))
        if identity_guard:
            identity_guard.check()
        return refs

    def capture_control(self, request: dict[str, Any], identity_guard=None) -> dict[str, Any]:
        # A device recorder is shared by request threads.  Do not queue a
        # second stop that could affect a later capture generation.
        if not self._capture_command_lock.acquire(blocking=False):
            mode = (request.get("request") or {}).get("mode", "sampled-frames/v1")
            return {"accepted": False, "mode": mode, "artifactRefs": [], "reason": "capture command is already running"}
        try:
            return self._capture_control(request, identity_guard)
        finally:
            self._capture_command_lock.release()

    def close_native_captures(self, timeout_ms: int) -> bool:
        deadline = time.monotonic() + timeout_ms / 1000
        if not self._recording_lock.acquire(timeout=max(0, deadline - time.monotonic())):
            return False
        try:
            owned = [(key, value) for key, value in self._recording.items() if value.get("identityGuard") is not None]
        finally:
            self._recording_lock.release()
        for key, active in owned:
            remaining = int((deadline - time.monotonic()) * 1000)
            if remaining < 1:
                return False
            result = self.capture_control({"request": {"runId": key, "stagingDir": str(active["staging"]),
                "action": "stop", "mode": active["mode"], "stopTimeoutMs": remaining}}, identity_guard=active["identityGuard"])
            if result.get("stopped") is not True:
                return False
        return True

    def _capture_control(self, request: dict[str, Any], identity_guard=None) -> dict[str, Any]:
        value = request.get("request") or {}
        run_id = str(value.get("runId", "run"))
        staging = self._safe_staging(value.get("stagingDir"), run_id)
        action = value.get("action")
        mode = value.get("mode", "sampled-frames/v1")
        key = run_id
        if action not in ("start", "stop", "discard") or mode not in ("video", "sampled-frames/v1"):
            return {"accepted": False, "mode": mode if mode in ("video", "sampled-frames/v1") else "sampled-frames/v1", "artifactRefs": [], "reason": "capture action/mode is invalid"}
        if mode == "sampled-frames/v1":
            required_capture_fields = ("intervalMs", "maxFrames", "maxBytes", "stopTimeoutMs") if action == "start" else ("stopTimeoutMs",)
            if any(type(value.get(field)) is not int or int(value.get(field)) <= 0 for field in required_capture_fields):
                return {"accepted": False, "mode": mode, "artifactRefs": [], "reason": "sampled-frame capture parameters must be positive integers"}
        if mode == "video" and action == "start":
            max_bytes = value.get("maxBytes", 1_073_741_824)
            if type(max_bytes) is not int or max_bytes <= 0:
                return {"accepted": False, "mode": mode, "artifactRefs": [], "reason": "video maxBytes must be a positive integer"}
        if action == "start":
            if identity_guard:
                try:
                    identity_guard.check()
                except Exception:
                    return {"accepted": False, "mode": mode, "artifactRefs": [], "reason": "native-capture-guard-failed"}
            with self._recording_lock:
                if self._recording:
                    return {"accepted": False, "mode": mode, "artifactRefs": [], "reason": "capture already active"}
                capture_dir = self._safe_artifact_path(staging, "artifacts/video" if mode == "video" else "artifacts/frames")
                if capture_dir.exists() and (not capture_dir.is_dir() or any(capture_dir.iterdir())):
                    return {"accepted": False, "mode": mode, "artifactRefs": [], "reason": "capture output already exists"}
                backend = self._video_backend() if mode == "video" else None
                if mode == "video" and identity_guard:
                    backend = (identity_guard.start_video, identity_guard.stop_video, "mp4")
                if backend is not None:
                    start_recording, stop_recording, extension = backend
                    path = self._safe_artifact_path(staging, "artifacts/video/0001." + extension)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        started = start_recording(output=str(path))
                        if extension == "mp4" and started != str(path):
                            return {"accepted": False, "mode": mode, "artifactRefs": [], "reason": "video start was not confirmed"}
                        active = {"mode": mode, "staging": staging, "path": path, "maxBytes": int(value.get("maxBytes", 1_073_741_824)), "stopRecording": stop_recording, "confirmStop": extension == "mp4", "identityGuard": identity_guard}
                        self._recording[key] = active
                        if identity_guard:
                            active["videoWatch"] = NativeCaptureVideo(identity_guard)
                            identity_guard.check_video()
                        return {"accepted": True, "mode": mode, "artifactRefs": []}
                    except Exception as exc:
                        if identity_guard and identity_guard.start_unconfirmed:
                            self._recording[key] = {"mode": mode, "staging": staging, "path": path, "identityGuard": identity_guard, "failure": "native-capture-start-unconfirmed"}
                            return {"accepted": False, "mode": mode, "artifactRefs": [], "reason": "native-capture-start-unconfirmed", "stopped": False}
                        if identity_guard and key in self._recording and "videoWatch" not in self._recording[key]:
                            self._recording[key]["failure"] = "native-capture-monitor-unavailable"
                            return {"accepted": False, "mode": mode, "artifactRefs": [], "reason": "native-capture-monitor-unavailable", "stopped": False}
                        return {"accepted": False, "mode": mode, "artifactRefs": [], "reason": type(exc).__name__}
                if mode == "video":
                    return {"accepted": False, "mode": mode, "artifactRefs": [], "reason": "video capability is unavailable"}
                stop = threading.Event()
                active = {"mode": "sampled-frames/v1", "staging": staging, "stop": stop, "maxFrames": int(value.get("maxFrames", 300)), "maxBytes": int(value.get("maxBytes", 1_073_741_824)), "frames": 0, "bytes": 0, "identityGuard": identity_guard}
                active["thread"] = threading.Thread(target=self._sample, args=(stop, staging, int(value.get("intervalMs", 1000)), key), daemon=True)
                self._recording[key] = active
                active["thread"].start()
                return {"accepted": True, "mode": "sampled-frames/v1", "artifactRefs": []}

        # Never hold _recording_lock while waiting for the sampler.  The
        # worker needs that lock to publish its final frame counters, so doing
        # a join inside the critical section creates a deterministic timeout.
        with self._recording_lock:
            active = self._recording.get(key)
            if not active:
                if mode == "sampled-frames/v1":
                    return {"accepted": action == "discard", "mode": mode, "artifactRefs": [], "frameCount": 0, "byteCount": 0, "stopped": True, **({"reason": "capture is not active"} if action == "stop" else {})}
                return {"accepted": action == "discard", "mode": mode, "artifactRefs": [], "stopped": True, **({"reason": "capture is not active"} if action == "stop" else {})}
            if active.get("staging") != staging:
                return {"accepted": False, "mode": mode, "artifactRefs": [], "reason": "capture staging mismatch"}
            if active.get("mode") != mode:
                return {"accepted": False, "mode": mode, "artifactRefs": [], "reason": "capture mode mismatch"}
            if active.get("identityGuard") is not identity_guard:
                return {"accepted": False, "mode": mode, "artifactRefs": [], "reason": "capture identity mismatch"}
            active_mode = str(active["mode"])
            sampler = active.get("thread") if active_mode == "sampled-frames/v1" else None
            if active_mode == "sampled-frames/v1":
                active["stop"].set()

        if active_mode == "video" and identity_guard and "videoWatch" not in active and not identity_guard.start_unconfirmed:
            try:
                active["videoWatch"] = NativeCaptureVideo(identity_guard, monitor=False)
            except Exception:
                return {"accepted": False, "mode": active_mode, "artifactRefs": [], "reason": "native-capture-stop-unconfirmed", "stopped": False}
        if sampler is not None:
            timeout_ms = value.get("stopTimeoutMs", 5_000)
            try:
                timeout = max(0.1, int(timeout_ms) / 1000)
            except (TypeError, ValueError):
                return {"accepted": False, "mode": active_mode, "artifactRefs": [], "reason": "invalid stop timeout"}
            sampler.join(timeout=timeout)
            if sampler.is_alive():
                return {"accepted": False, "mode": active_mode, "artifactRefs": [], "reason": "sampled-frame worker did not stop"}
        elif active_mode == "video" and "videoWatch" in active:
            stopped = active["videoWatch"].stop(value.get("stopTimeoutMs", 5000))
            if not stopped["stopped"]:
                return {"accepted": False, "mode": active_mode, "artifactRefs": [], "reason": stopped["reason"], "stopped": False}
            if stopped.get("failure"):
                active["failure"] = stopped["failure"]
        elif active_mode == "video" and identity_guard:
            return {"accepted": False, "mode": active_mode, "artifactRefs": [], "reason": "native-capture-stop-unconfirmed", "stopped": False}
        elif active_mode == "video":
            try:
                stop_recording = active.get("stopRecording")
                if not callable(stop_recording):
                    return {"accepted": False, "mode": active_mode, "artifactRefs": [], "reason": "video stop backend is unavailable"}
                stopped = stop_recording()
                if stopped is False or active.get("confirmStop") and stopped is not True:
                    return {"accepted": False, "mode": active_mode, "artifactRefs": [], "reason": "video stop was not confirmed"}
            except Exception as exc:
                return {"accepted": False, "mode": active_mode, "artifactRefs": [], "reason": type(exc).__name__}

        with self._recording_lock:
            current = self._recording.get(key)
            if current is not active:
                return {"accepted": False, "mode": active_mode, "artifactRefs": [], "reason": "capture state changed during stop"}
            frame_count = int(active.get("frames", 0)) if active_mode == "sampled-frames/v1" else None
            byte_count = int(active.get("bytes", 0)) if active_mode == "sampled-frames/v1" else None
            frame_failure = active.get("failure")
            self._recording.pop(key, None)
        if action == "discard":
            shutil.rmtree(active["staging"] / "artifacts" / ("video" if active_mode == "video" else "frames"), ignore_errors=True)
        if action == "stop" and active_mode == "sampled-frames/v1" and frame_count == 0:
            return {"accepted": False, "mode": active_mode, "artifactRefs": [], "reason": "sampled-frame capture produced zero frames", "frameCount": frame_count, "byteCount": byte_count, "stopped": True}
        if action == "stop" and active_mode == "sampled-frames/v1":
            if frame_failure or not self._validated_frame_capture(active):
                reason = "sampled-frame capture failed" if frame_failure else "sampled-frame artifacts do not match capture"
                return {"accepted": False, "mode": active_mode, "artifactRefs": [], "reason": reason, "frameCount": frame_count, "byteCount": byte_count, "stopped": True}
        if action == "stop" and active_mode == "video":
            if frame_failure:
                return {"accepted": False, "mode": active_mode, "artifactRefs": [], "reason": frame_failure, "stopped": True}
            try:
                artifact_ref = self._validated_video_artifact(active)
            except RuntimeError as exc:
                return {"accepted": False, "mode": active_mode, "artifactRefs": [], "reason": str(exc), "stopped": True}
            return {"accepted": True, "mode": active_mode, "artifactRefs": [artifact_ref], "stopped": True}
        return {"accepted": True, "mode": active_mode, "artifactRefs": [], "stopped": True, **({"frameCount": frame_count, "byteCount": byte_count} if frame_count is not None else {})}

    def _sample(self, stop: threading.Event, staging: Path, interval_ms: int, key: str) -> None:
        index = 1
        while not stop.is_set():
            try:
                with self._recording_lock:
                    active = self._recording.get(key)
                    if not active or active.get("frames", 0) >= active.get("maxFrames", 300):
                        stop.set()
                        break
                guard = active.get("identityGuard")
                name = f"frames/frame-{index:04d}.png"
                path = self._snapshot(staging, name, identity_guard=guard) if guard else self._snapshot(staging, name)
                artifact = self._artifact_ref(path, staging)
                size = artifact["size"]
                if size <= 0:
                    raise RuntimeError("sampled frame is empty")
                if guard:
                    guard.check()
                with self._recording_lock:
                    active = self._recording.get(key)
                    if active:
                        max_bytes = int(active.get("maxBytes", 1_073_741_824))
                        if int(active.get("bytes", 0)) + size > max_bytes:
                            path.unlink(missing_ok=True)
                            stop.set()
                        else:
                            active["frames"] = int(active.get("frames", 0)) + 1
                            active["bytes"] = int(active.get("bytes", 0)) + size
                            active.setdefault("artifacts", []).append(artifact)
                            if active["bytes"] >= max_bytes:
                                stop.set()
            except Exception:
                with self._recording_lock:
                    active = self._recording.get(key)
                    if active:
                        active["failure"] = "sampled-frame capture failed"
                stop.set()
            index += 1
            stop.wait(max(0.1, interval_ms / 1000))


class Handler(BaseHTTPRequestHandler):
    state: BridgeState

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _native_endpoint(self) -> str:
        parsed = urlsplit(self.path)
        host = self.headers.get("Host", "").lower()
        port = self.server.server_address[1]
        suffix = "" if port == 80 else ":" + str(port)
        if len(self.headers.get_all("Host", [])) != 1 or host not in {"127.0.0.1" + suffix, "localhost" + suffix}:
            raise NativeIdentityExchangeError("http-context-invalid", 400)
        if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment or not parsed.path.startswith("/"):
            raise NativeIdentityExchangeError("http-context-invalid", 400)
        path = parsed.path.rstrip("/")
        return "http://" + host + path[:path.rfind("/") + 1]

    def _send(self, value: Any, status: int = 200, limit: int = MAX_JSON_BYTES) -> None:
        data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(data) > limit:
            data = json.dumps({"error": "response exceeds size limit"}).encode("utf-8")
            status = 500
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:  # noqa: N802
        content_type = self.headers.get("Content-Type", "")
        content_parts = [part.strip() for part in content_type.split(";")]
        if not content_parts or content_parts[0].lower() != "application/json" or any(not part.lower().startswith("charset=") or not part[8:].strip() for part in content_parts[1:]):
            self._send({"error": "Content-Type must be application/json"}, 415)
            return
        origin = self.headers.get("Origin")
        if origin:
            try:
                parsed = urlsplit(origin)
                server_port = self.server.server_address[1]
                # A same-origin loopback UI may call the bridge; every other
                # Origin is rejected before JSON parsing to close CSRF paths.
                allowed_origins = {f"http://127.0.0.1:{server_port}", f"http://localhost:{server_port}"}
                if parsed.scheme not in ("http",) or parsed.path or parsed.query or parsed.fragment or origin not in allowed_origins:
                    self._send({"error": "cross-origin requests are not allowed"}, 403)
                    return
            except Exception:
                self._send({"error": "invalid Origin"}, 403)
                return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except (TypeError, ValueError):
            self._send({"error": "invalid content length"}, 413)
            return
        if length <= 0 or length > MAX_JSON_BYTES:
            self._send({"error": "request exceeds size limit"}, 413)
            return
        operation = self.path.rstrip("/").split("/")[-1]
        if operation in ("native-identity-open", "native-identity-observe") and length > 4096:
            self._send({"error": "native-identity: request-too-large"}, 413)
            return
        if operation in ("native-action", "native-capture") and length > 65536:
            self._send({"error": "native-identity: request-too-large"}, 413)
            return
        try:
            request = json.loads(self.rfile.read(length).decode("utf-8"), parse_constant=reject_json_constant)
            if not isinstance(request, dict):
                raise ValueError("JSON request must be an object")
        except (UnicodeDecodeError, ValueError):
            self._send({"error": "request must be a valid JSON object"}, 400)
            return
        try:
            if operation == "capabilities": value = self.state.capabilities()
            elif operation == "native-identity-open": value = self.state.native_identity_exchange.open(request, self._native_endpoint())
            elif operation == "native-identity-observe": value = self.state.native_identity_exchange.observe(request, self._native_endpoint())
            elif operation == "native-action": value = self.state.native_identity_exchange.actions.perform(request, self._native_endpoint())
            elif operation == "native-capture": value = self.state.native_identity_exchange.captures.perform(request, self._native_endpoint())
            elif operation == "observe": value = self.state.observe(request)
            elif operation == "generate-candidates": value = self.state.generate_candidates(request)
            elif operation == "discover-candidates": value = self.state.discover_candidates(request)
            elif operation == "execute": value = self.state.execute(request)
            elif operation == "recover": value = self.state.recover(request)
            elif operation == "capture-evidence": value = self.state.capture_evidence(request)
            elif operation == "capture-control": value = self.state.capture_control(request)
            else: self._send({"error": "unsupported operation"}, 404); return
            self._send(value, limit=4 * 1024 * 1024 if operation == "native-capture" else MAX_JSON_BYTES)
        except NativeIdentityExchangeError as exc:
            self._send({"error": exc.code}, exc.status)
        except Exception as exc:
            self._send({"error": type(exc).__name__}, 500)


def main() -> None:
    parser = argparse.ArgumentParser(description="Lakda Airtest/Poco loopback bridge")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--platform", choices=["windows", "android", "ios"], required=True)
    parser.add_argument("--device-uri")
    parser.add_argument("--target-revision", required=True)
    parser.add_argument("--app-id")
    parser.add_argument("--app-revision")
    parser.add_argument("--platform-version")
    parser.add_argument("--serial-digest")
    parser.add_argument("--device-alias-digest")
    parser.add_argument("--surface")
    parser.add_argument("--templates")
    parser.add_argument("--templates-root", help="template paths are resolved below this directory (default: manifest directory)")
    parser.add_argument("--output-dir", default=".lakda/bridge")
    parser.add_argument("--allowed-staging-root", default=".lakda/runs")
    args = parser.parse_args()
    if args.host != "127.0.0.1":
        raise SystemExit("bridge host must remain 127.0.0.1")
    state = BridgeState(args)
    Handler.state = state
    server = None
    try:
        server = ThreadingHTTPServer((args.host, args.port), Handler)
        server.serve_forever()
    finally:
        try:
            state.native_identity_exchange.close()
        finally:
            if server is not None:
                server.server_close()


if __name__ == "__main__":
    main()
