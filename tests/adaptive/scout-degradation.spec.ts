import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { scoutCommand, type ScoutCommandRuntime } from "../../src/commands/scouting.js";

const roots: string[] = [];

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture(configuredMode: "rule-only" | "loopback" = "loopback") {
  const root = await mkdtemp(join(tmpdir(), "lakda-scout-degradation-"));
  roots.push(root);
  const suite = join(root, "trace.json");
  const config = join(root, "lakda.config.json");
  const out = join(root, "leads.json");
  await writeFile(suite, JSON.stringify({
    runId: "run-scout-degradation",
    trace: [{ executionId: "exec-1", status: "timeout", failureSignature: "request timeout" }],
  }));
  await writeFile(config, JSON.stringify({
    schemaVersion: "lakda/v1",
    llm: {
      enabled: true,
      baseUrl: "http://127.0.0.1:8080/v1/",
      expectedModelId: "expected-model",
      modelPath: join(root, "model.gguf"),
      modelSha256: "A".repeat(64),
    },
    extensions: {
      scouting: {
        mode: configuredMode,
        leadCap: 3,
      },
    },
  }));
  return { suite, config, out, evidence: join(dirname(out), "scout-evidence.jsonl") };
}

function runtime(options: {
  preflightError?: Error;
  scoutError?: Error;
  response?: unknown;
  counters: { providers: number; preflights: number; scouts: number };
}): ScoutCommandRuntime {
  return {
    createClient: () => {
      options.counters.providers += 1;
      return {
        preflight: async () => {
          options.counters.preflights += 1;
          if (options.preflightError) throw options.preflightError;
          return "expected-model";
        },
        scout: async () => {
          options.counters.scouts += 1;
          if (options.scoutError) throw options.scoutError;
          return options.response;
        },
      };
    },
  };
}

async function artifacts(out: string, evidence: string) {
  return {
    report: JSON.parse(await readFile(out, "utf8")) as Record<string, unknown>,
    evidence: JSON.parse((await readFile(evidence, "utf8")).trim()) as Record<string, unknown>,
  };
}

test.describe("P9 LLM scouting degradation contract", () => {
  const cases = [
    { name: "timeout", scoutError: new Error("request deadline 100ms") },
    { name: "model/attestation mismatch", preflightError: new Error("GGUF SHA-256 mismatch") },
    { name: "non-JSON", scoutError: new Error("JSON object required") },
    {
      name: "extra key",
      response: {
        schemaVersion: "lakda/llm-scout-response/v1",
        leadId: "unresolved-until-runtime",
        priority: 90,
        rationaleRef: "sha256:" + "a".repeat(64),
        actionRefs: [],
        extra: true,
      },
    },
    {
      name: "unoffered lead",
      response: {
        schemaVersion: "lakda/llm-scout-response/v1",
        leadId: "lead-never-offered",
        priority: 90,
        rationaleRef: "sha256:" + "a".repeat(64),
        actionRefs: [],
      },
    },
  ] as const;

  for (const scenario of cases) {
    test(`${scenario.name}: retains rule-first output, records rejection, and never switches provider`, async () => {
      const paths = await fixture();
      const counters = { providers: 0, preflights: 0, scouts: 0 };
      const code = await scoutCommand(
        { suite: paths.suite, config: paths.config, out: paths.out, "scout-mode": "llm" },
        runtime({ ...scenario, counters }),
      );
      const result = await artifacts(paths.out, paths.evidence);

      expect(code).toBe(2);
      expect(result.report).toMatchObject({ scoutStatus: "partial", requestedMode: "llm", effectiveMode: "none" });
      expect(result.report.signals).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "timeout" })]));
      expect(result.report.leadObjects).toEqual(expect.arrayContaining([expect.objectContaining({ leadType: "timeout" })]));
      expect(result.evidence).toMatchObject({ accepted: false, providerSwitchAttempted: false });
      expect(result.evidence.rejectionReasonDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(result.evidence.responseSchemaHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(result.evidence.modelAttestationRef).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(result.evidence.runRevision).toBe("unavailable");
      expect(JSON.stringify(result.evidence)).not.toContain("request deadline");
      expect(result.evidence).not.toHaveProperty("response");
      if ("response" in scenario) {
        expect(result.evidence.outputDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(JSON.stringify(result.evidence)).not.toContain(String(scenario.response.leadId));
      }
      expect(counters.providers).toBe(1);
    });
  }

  test("uses rule-only degradation only when configured, while preserving partial exit", async () => {
    const paths = await fixture("rule-only");
    const counters = { providers: 0, preflights: 0, scouts: 0 };
    const code = await scoutCommand(
      { suite: paths.suite, config: paths.config, out: paths.out, "scout-mode": "llm" },
      runtime({ scoutError: new Error("request deadline 100ms"), counters }),
    );
    const result = await artifacts(paths.out, paths.evidence);

    expect(code).toBe(2);
    expect(result.report).toMatchObject({ scoutStatus: "partial", requestedMode: "llm", effectiveMode: "rule-only" });
  });

  test("preserves accepted LLM scouting behavior", async () => {
    const paths = await fixture();
    await writeFile(paths.suite, JSON.stringify({
      runId: "run-scout-degradation",
      runnerRevision: "runner-revision-42",
      trace: [{ executionId: "exec-1", status: "timeout", failureSignature: "request timeout" }],
    }));
    const acceptedRuntime: ScoutCommandRuntime = {
      createClient: () => ({
        preflight: async () => "expected-model",
        scout: async context => ({
          schemaVersion: "lakda/llm-scout-response/v1",
          leadId: context.leadRefs[0],
          priority: 91,
          rationaleRef: "sha256:" + "a".repeat(64),
          actionRefs: [],
        }),
      }),
    };
    const code = await scoutCommand(
      { suite: paths.suite, config: paths.config, out: paths.out, "scout-mode": "llm" },
      acceptedRuntime,
    );
    const result = await artifacts(paths.out, paths.evidence);

    expect(code).toBe(0);
    expect(result.report).toMatchObject({
      scoutStatus: "completed",
      requestedMode: "llm",
      effectiveMode: "llm",
    });
    expect(result.evidence).toMatchObject({ accepted: true, providerSwitchAttempted: false });
    expect(result.evidence.runRevision).toBe("runner-revision-42");
    expect(result.evidence.outputDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.evidence).not.toHaveProperty("rejectionReasonDigest");
  });

  for (const unsafeRevision of [
    "C:\\Users\\Alice\\private-repository",
    "/home/alice/private-repository",
    "token-supersecret",
    "alice@example.com",
    "090-1234-5678",
  ]) {
    test("does not persist an unsafe run revision: " + unsafeRevision, async () => {
      const paths = await fixture();
      await writeFile(paths.suite, JSON.stringify({
        runId: "run-scout-unsafe-revision",
        runnerRevision: unsafeRevision,
        trace: [{ executionId: "exec-1", status: "timeout", failureSignature: "request timeout" }],
      }));
      const counters = { providers: 0, preflights: 0, scouts: 0 };
      const code = await scoutCommand(
        { suite: paths.suite, config: paths.config, out: paths.out, "scout-mode": "llm" },
        runtime({ scoutError: new Error("request deadline 100ms"), counters }),
      );
      const result = await artifacts(paths.out, paths.evidence);

      expect(code).toBe(2);
      expect(result.evidence.runRevision).toBe("unavailable");
      expect(JSON.stringify(result.evidence)).not.toContain(unsafeRevision);
    });
  }
});
