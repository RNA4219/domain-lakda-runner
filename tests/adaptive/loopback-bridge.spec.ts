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

test("loopback bridge rejects non-JSON, oversized, malformed capability, and endpoint decoration", async () => {
  const fixture = await startFixture(url => {
    if (url.pathname === "/non-json/capabilities") return { contentType: "text/html", body: "<p>not json</p>" };
    if (url.pathname === "/oversized/capabilities") return { contentType: "application/json", body: " ".repeat(1_048_577) };
    if (url.pathname === "/malformed/capabilities") return { contentType: "application/json", body: JSON.stringify({ adapterId: "security" }) };
    return { status: 404, body: "missing" };
  });
  try {
    await expect(LoopbackJsonBridge.connect(fixture.baseUrl + "/non-json", "security")).rejects.toThrow(/non-JSON/);
    await expect(LoopbackJsonBridge.connect(fixture.baseUrl + "/oversized", "security")).rejects.toThrow(/size limit/);
    await expect(LoopbackJsonBridge.connect(fixture.baseUrl + "/malformed", "security")).rejects.toThrow(/schema/);
    await expect(LoopbackJsonBridge.connect(fixture.baseUrl + "?token=secret", "security")).rejects.toThrow(/query/);
    await expect(LoopbackJsonBridge.connect(fixture.baseUrl + "#fragment", "security")).rejects.toThrow(/fragment/);
  } finally {
    await fixture.close();
  }
});
