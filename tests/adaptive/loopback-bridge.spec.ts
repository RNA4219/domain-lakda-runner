import { expect, test } from "@playwright/test";
import { LoopbackJsonBridge } from "../../src/adapters/loopback-json.js";
import { startFixture } from "../fixtures/server.js";

test("loopback JSON bridge performs a capability handshake without starting an external process", async () => {
  const fixture = await startFixture(url => url.pathname === "/capabilities" ? {
    contentType: "application/json",
    body: JSON.stringify({ schemaVersion: "lakda/adaptive-contracts/v1", adapterId: "airtest-poco", revision: "1", targetKinds: ["device"], actionKinds: ["tap"], observationCapabilities: ["screen"], evidenceCapabilities: [], recoveryStrategies: [] }),
  } : { status: 404, body: "missing" });
  try {
    const bridge = await LoopbackJsonBridge.connect(fixture.baseUrl, "airtest-poco");
    expect(bridge.capabilities().adapterId).toBe("airtest-poco");
    await expect(LoopbackJsonBridge.connect("http://192.0.2.1:9000", "airtest-poco")).rejects.toThrow(/loopback/);
  } finally { await fixture.close(); }
});
