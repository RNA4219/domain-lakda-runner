import { expect, test } from "@playwright/test";
import { buildScoutContext, groupLeadsRuleOnly, scoutWithLoopback, signalsFromTrace } from "../../src/adaptive/scouting.js";
import { computeKpi, createInvestigation, promoteInvestigation, runStrictReplay, shrinkReproducingSequence } from "../../src/adaptive/investigation.js";

test("rule-first signal extraction is deterministic and lead-capped", () => {
  const trace = [{ executionId: "e-1", status: "timeout", failureSignature: "settle-timeout", preFingerprint: "fp-a" }, { executionId: "e-1", status: "timeout", failureSignature: "settle-timeout", preFingerprint: "fp-a" }, { executionId: "e-2", result: { oracleId: "o-1", verdict: "fail", severity: "major" } }];
  const first = signalsFromTrace(trace, "run-1"); const second = signalsFromTrace(trace, "run-1");
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  const leads = groupLeadsRuleOnly(first, 3);
  expect(leads.length).toBeLessThanOrEqual(3);
  expect(buildScoutContext(leads).policy.mode).toBe("loopback-json/v1");
});

test("scout response rejects unknown lead and extra keys", async () => {
  const lead = groupLeadsRuleOnly(signalsFromTrace([{ executionId: "e", status: "timeout" }], "r"))[0];
  const context = buildScoutContext([lead]);
  const client = { scout: async () => ({ schemaVersion: "lakda/llm-scout-response/v1", leadId: "lead-unknown", priority: 50, rationaleRef: "sha256:" + "0".repeat(64), actionRefs: [], extra: true }) };
  await expect(scoutWithLoopback(client, context, [lead])).rejects.toThrow(/unknown keys|unknown lead|invalid/);
});

test("investigation replay diverges fail-closed and promotion requires reproduced", async () => {
  const lead = groupLeadsRuleOnly(signalsFromTrace([{ executionId: "e", status: "timeout" }], "r"))[0];
  const pending = createInvestigation(lead, "reviewer:alice", "2026-07-15T00:00:00.000Z");
  const diverged = await runStrictReplay(pending, () => ({ reproduced: true, divergence: "fingerprint-mismatch" }));
  expect(diverged.status).toBe("replay_diverged");
  expect(() => promoteInvestigation(diverged, "trace", ["trace.json"])).toThrow(/reproduced/);
  const reproduced = await runStrictReplay(pending, () => ({ reproduced: true, oracleRefs: ["oracle-1"], evidenceRefs: ["trace.json"] }));
  const promotion = promoteInvestigation(reproduced, "trace", ["trace.json"]);
  expect(promotion.parentInvestigationDigest).toMatch(/^sha256:/);
});

test("shrinking respects mutation/scope/budget and KPI revision", async () => {
  const sequence = [{ id: "a", mutationKind: "none", targetHost: "127.0.0.1" }, { id: "b", mutationKind: "none", targetHost: "127.0.0.1" }, { id: "c", mutationKind: "none", targetHost: "127.0.0.1" }];
  const result = await shrinkReproducingSequence(sequence, async candidate => candidate.length >= 1 && candidate[0].id === "a", { maxAttempts: 10, allowedHosts: ["127.0.0.1"] });
  expect(result.status).toBe("shrunk"); expect(result.sequence).toHaveLength(1);
  expect((await shrinkReproducingSequence(sequence, async () => true, { allowedHosts: ["example.invalid"] })).status).toBe("skipped");
  expect(computeKpi(3, 4, "kpi/v2")).toMatchObject({ revision: "kpi/v2", ratio: 0.75 });
});