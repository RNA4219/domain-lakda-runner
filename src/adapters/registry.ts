import type { TargetKind } from "../adaptive/contracts.js";
import { assertAdaptiveContract } from "../adaptive/contracts.js";
import { AirtestPocoAdapter, SecurityAdapter, type ExternalToolBridge } from "./external-bridges.js";
import { PlaywrightAdaptiveAdapter, type PlaywrightAdaptiveAdapterOptions } from "./playwright.js";
import type { AdaptiveAdapter } from "./types.js";

export const BUILTIN_ADAPTER_IDS = ["playwright", "airtest-poco", "security"] as const;
export type BuiltInAdapterId = typeof BUILTIN_ADAPTER_IDS[number];

type AdapterRuntime =
  | { kind: "playwright"; options: PlaywrightAdaptiveAdapterOptions }
  | { kind: "loopback"; bridge: ExternalToolBridge };

export type BuiltInAdapterInstance =
  | { id: "playwright"; adapter: PlaywrightAdaptiveAdapter }
  | { id: "airtest-poco"; adapter: AirtestPocoAdapter }
  | { id: "security"; adapter: SecurityAdapter };

type AdapterRegistryEntry = {
  id: BuiltInAdapterId;
  targetKinds: readonly TargetKind[];
  runtimeKind: AdapterRuntime["kind"];
  create(runtime: AdapterRuntime): BuiltInAdapterInstance;
};

const registry = Object.freeze({
  playwright: Object.freeze({
    id: "playwright",
    targetKinds: Object.freeze(["page", "frame", "dialog"] as const),
    runtimeKind: "playwright",
    create(runtime: AdapterRuntime): BuiltInAdapterInstance {
      if (runtime.kind !== "playwright") throw new Error("playwright adapter requires the built-in Playwright runtime");
      return { id: "playwright", adapter: new PlaywrightAdaptiveAdapter(runtime.options) };
    },
  }),
  "airtest-poco": Object.freeze({
    id: "airtest-poco",
    targetKinds: Object.freeze(["device", "surface"] as const),
    runtimeKind: "loopback",
    create(runtime: AdapterRuntime): BuiltInAdapterInstance {
      if (runtime.kind !== "loopback") throw new Error("airtest-poco adapter requires an operator-managed loopback bridge");
      return { id: "airtest-poco", adapter: new AirtestPocoAdapter(runtime.bridge) };
    },
  }),
  security: Object.freeze({
    id: "security",
    targetKinds: Object.freeze(["http"] as const),
    runtimeKind: "loopback",
    create(runtime: AdapterRuntime): BuiltInAdapterInstance {
      if (runtime.kind !== "loopback") throw new Error("security adapter requires an operator-managed loopback bridge");
      return { id: "security", adapter: new SecurityAdapter(runtime.bridge) };
    },
  }),
} satisfies Record<BuiltInAdapterId, AdapterRegistryEntry>);

export function assertBuiltInAdapterId(value: unknown): asserts value is BuiltInAdapterId {
  if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(registry, value)) throw new Error("adaptive.adapter.id must reference a built-in adapter");
}

export function assertBuiltInAdapterConfiguration(id: unknown, allowTargetKinds: TargetKind[], initialTargetKind?: TargetKind): asserts id is BuiltInAdapterId {
  assertBuiltInAdapterId(id);
  const supported = new Set<TargetKind>(registry[id].targetKinds);
  const unsupported = allowTargetKinds.filter(kind => !supported.has(kind));
  if (unsupported.length) throw new Error(`adaptive adapter capability mismatch: ${unsupported.join(",")}`);
  if (initialTargetKind && !supported.has(initialTargetKind)) throw new Error("adaptive initial target capability mismatch");
}

export function createBuiltInAdapter(id: unknown, runtime: AdapterRuntime): BuiltInAdapterInstance {
  assertBuiltInAdapterId(id);
  const entry = registry[id];
  if (entry.runtimeKind !== runtime.kind) throw new Error("adaptive adapter runtime capability mismatch");
  return entry.create(runtime);
}

export function assertBuiltInAdapterCapabilities(instance: BuiltInAdapterInstance, allowTargetKinds: TargetKind[], initialTargetKind?: TargetKind): void {
  const capabilities = instance.adapter.capabilities();
  assertAdaptiveContract(capabilities);
  if (capabilities.adapterId !== instance.id) throw new Error("adaptive adapter capability identity mismatch");
  const missing = allowTargetKinds.filter(kind => !capabilities.targetKinds.includes(kind));
  if (missing.length) throw new Error(`adaptive adapter runtime capability mismatch: ${missing.join(",")}`);
  if (initialTargetKind && !capabilities.targetKinds.includes(initialTargetKind)) throw new Error("adaptive initial target runtime capability mismatch");
}

export function adapterFromInstance(instance: BuiltInAdapterInstance): AdaptiveAdapter {
  return instance.adapter;
}