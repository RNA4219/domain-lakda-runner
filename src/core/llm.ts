import { createRequire } from "node:module";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { once } from "node:events";
import type { Action, LakdaConfig, LlmDecision, LlmEvidence } from "./types.js";
import { assertLoopbackEndpoint } from "./safety.js";
import { redactJson, sha256 } from "./redaction.js";

const decisionSchema = {
  type: "object",
  oneOf: [
    { required: ["decision", "candidateId", "reason", "confidence"], additionalProperties: false, properties: { decision: { const: "action" }, candidateId: { type: "string", minLength: 1 }, inputProfileId: { type: "string", minLength: 1 }, reason: { type: "string", minLength: 1 }, confidence: { enum: ["low", "medium", "high"] } } },
    { required: ["decision", "reason", "confidence"], additionalProperties: false, properties: { decision: { enum: ["stop", "hold"] }, reason: { type: "string", minLength: 1 }, confidence: { enum: ["low", "medium", "high"] } } },
  ],
};
type Validator = ((value: unknown) => boolean) & { errors?: Array<{ message?: string }> };
type AjvConstructor = new (options: object) => { compile(value: object): Validator };
const Ajv = createRequire(import.meta.url)("ajv").default as AjvConstructor;
const validateDecision = new Ajv({ allErrors: true, strict: false }).compile(decisionSchema);
const schemaHash = sha256(JSON.stringify(decisionSchema));

class RetryableProviderError extends Error { constructor(message: string) { super(message); this.name = "RetryableProviderError"; } }

export class LlmContractError extends Error { constructor(message: string, readonly evidence?: LlmEvidence) { super(message); this.name = "LlmContractError"; } }

function endpoint(config: LakdaConfig, path: string): string {
  const base = assertLoopbackEndpoint(config.llm.baseUrl);
  return new URL(path.replace(/^\//, ""), `${base.toString().replace(/\/$/, "")}/`).toString();
}

const modelSha256Cache = new Map<string, { size: number; mtimeMs: number; sha256: string }>();

async function fileSha256(path: string, attempt = 0): Promise<string> {
  const before = await stat(path);
  const cached = modelSha256Cache.get(path);
  if (cached && cached.size === before.size && cached.mtimeMs === before.mtimeMs) return cached.sha256;
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", chunk => hash.update(chunk));
  await once(stream, "end");
  const after = await stat(path);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    if (attempt >= 1) throw new LlmContractError("GGUFがhash計算中に変更されました");
    return fileSha256(path, attempt + 1);
  }
  const sha256 = hash.digest("hex").toUpperCase();
  modelSha256Cache.set(path, { size: after.size, mtimeMs: after.mtimeMs, sha256 });
  return sha256;
}

function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

function strictJson(text: string): unknown {
  let cursor = 0;
  const whitespace = () => { while (/\s/.test(text[cursor] ?? "")) cursor += 1; };
  const string = (): string => {
    const start = cursor;
    if (text[cursor] !== '"') throw new LlmContractError("JSON stringが必要です");
    cursor += 1;
    while (cursor < text.length) {
      if (text[cursor] === "\\") { cursor += 2; continue; }
      if (text[cursor] === '"') { cursor += 1; return JSON.parse(text.slice(start, cursor)) as string; }
      cursor += 1;
    }
    throw new LlmContractError("JSON stringが閉じていません");
  };
  const value = (): void => {
    whitespace(); const current = text[cursor];
    if (current === "{") {
      cursor += 1; whitespace(); const keys = new Set<string>();
      if (text[cursor] === "}") { cursor += 1; return; }
      while (true) {
        whitespace(); const key = string();
        if (keys.has(key)) throw new LlmContractError(`JSON重複key: ${key}`);
        keys.add(key); whitespace(); if (text[cursor] !== ":") throw new LlmContractError("JSON colonが必要です"); cursor += 1; value(); whitespace();
        if (text[cursor] === "}") { cursor += 1; return; }
        if (text[cursor] !== ",") throw new LlmContractError("JSON commaが必要です"); cursor += 1;
      }
    }
    if (current === "[") { cursor += 1; whitespace(); if (text[cursor] === "]") { cursor += 1; return; } while (true) { value(); whitespace(); if (text[cursor] === "]") { cursor += 1; return; } if (text[cursor] !== ",") throw new LlmContractError("JSON commaが必要です"); cursor += 1; } }
    if (current === '"') { string(); return; }
    const literal = text.slice(cursor).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
    if (!literal) throw new LlmContractError("JSON valueが不正です");
    cursor += literal.length;
  };
  value(); whitespace(); if (cursor !== text.length) throw new LlmContractError("JSON末尾に余分な値があります");
  return JSON.parse(text) as unknown;
}

function responseContent(raw: Uint8Array, contentType: string): { content: string; responseTokens?: number } {
  const text = new TextDecoder().decode(raw).trim();
  if (!contentType.includes("text/event-stream")) {
    const json = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }>; usage?: { completion_tokens?: number } };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new LlmContractError("completion contentがありません");
    return { content, responseTokens: json.usage?.completion_tokens };
  }
  let content = ""; let tokens: number | undefined; let done = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    if (payload === "[DONE]") { done = true; continue; }
    let event: { choices?: Array<{ delta?: { content?: string } }>; usage?: { completion_tokens?: number } };
    try { event = JSON.parse(payload) as typeof event; } catch { throw new LlmContractError("SSE JSONが不正です"); }
    content += event.choices?.[0]?.delta?.content ?? "";
    tokens = event.usage?.completion_tokens ?? tokens;
  }
  if (!done) throw new LlmContractError("SSE [DONE]がありません");
  if (!content) throw new LlmContractError("SSE contentがありません");
  return { content, responseTokens: tokens };
}

async function readResponse(response: Response, startedAt: number, timeoutMs: number): Promise<{ raw: Uint8Array; ttftMs?: number }> {
  if (!response.body) return { raw: new Uint8Array(await response.arrayBuffer()), ttftMs: Math.round(performance.now() - startedAt) };
  const chunks: Uint8Array[] = []; const reader = response.body.getReader(); const decoder = new TextDecoder();
  const stream = response.headers.get("content-type")?.includes("text/event-stream") === true; let tail = ""; let ttftMs: number | undefined; let size = 0;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new LlmContractError(`generation deadline ${timeoutMs}ms`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new LlmContractError(`generation deadline ${timeoutMs}ms`)), remaining); }),
      ]);
      const { done, value } = next; if (done) break;
      size += value.byteLength; if (size > 1_048_576) throw new LlmContractError("LLM response exceeds 1MiB");
      chunks.push(value);
      if (!stream) continue;
      tail += decoder.decode(value, { stream: true });
      let newline = tail.indexOf("\n");
      while (newline >= 0) {
        const line = tail.slice(0, newline).replace(/\r$/, ""); tail = tail.slice(newline + 1); newline = tail.indexOf("\n");
        if (!line.startsWith("data:") || ttftMs !== undefined) continue;
        const payload = line.slice(5).trim(); if (!payload || payload === "[DONE]") continue;
        try { if ((JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content) ttftMs = Math.round(performance.now() - startedAt); } catch { /* full parser emits the protocol error after stream close */ }
      }
    } catch (error) {
      if (error instanceof LlmContractError || error instanceof RetryableProviderError) throw error;
      throw new RetryableProviderError(error instanceof Error ? error.message : "connection reset");
    } finally { if (timer) clearTimeout(timer); }
  }

  const raw = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
  return { raw, ttftMs: ttftMs ?? (stream ? undefined : Math.round(performance.now() - startedAt)) };
}

export class LocalLlmClient {
  constructor(private readonly config: LakdaConfig) { assertLoopbackEndpoint(config.llm.baseUrl); }

  async preflight(): Promise<string> {
    if (!this.config.llm.modelPath || !this.config.llm.modelSha256) throw new LlmContractError("modelPath/modelSha256 が必要です");
    const actualSha = await fileSha256(this.config.llm.modelPath);
    if (actualSha !== this.config.llm.modelSha256.toUpperCase()) throw new LlmContractError("GGUF SHA-256が一致しません");
    const response = await this.fetch(endpoint(this.config, "models"), { method: "GET" }, this.config.llm.connectTimeoutMs);
    const models = await response.json() as { data?: Array<{ id?: string }> };
    if (!models.data?.some(model => model.id === this.config.llm.expectedModelId)) throw new LlmContractError("指定model IDが /v1/models にありません");
    const probe = await this.complete({ messages: [{ role: "user", content: "Reply with {}" }], max_tokens: 32, stream: false }, 1);
    if (!probe.rawResponseSha256) throw new LlmContractError("preflight completionが失敗しました");
    return this.config.llm.expectedModelId;
  }

  async decide(candidates: Action[], summary: object): Promise<{ decision: LlmDecision; evidence: LlmEvidence }> {
    const prompt = { candidates: candidates.map(candidate => ({ id: candidate.id, kind: candidate.kind, inputProfileId: candidate.inputProfileId })), summary, instruction: "Return only strict JSON matching the decision schema. Do not invent IDs, URL, selector, code, path, or command." };
    const response = await this.complete({ messages: [{ role: "system", content: "You select only supplied safe candidate IDs." }, { role: "user", content: JSON.stringify(prompt) }], max_tokens: this.config.llm.maxTokens, stream: true }, 0);
    let parsed: unknown;
    try { parsed = strictJson(response.content); }
    catch (error) { throw this.contractError(response, error instanceof Error ? error.message : "JSON不正"); }
    if (!validateDecision(parsed)) throw this.contractError(response, `decision schema不適合: ${validateDecision.errors?.map(error => error.message).join(", ")}`);
    const decision = parsed as LlmDecision;
    if (decision.decision === "action") {
      const candidate = candidates.find(value => value.id === decision.candidateId);
      if (!candidate) throw this.contractError(response, "提示されていないcandidate IDです");
      if (decision.inputProfileId !== undefined && decision.inputProfileId !== candidate.inputProfileId) throw this.contractError(response, "candidateのinputProfileIdと一致しません");
    }
    const { content: _content, ...evidence } = response;
    void _content;
    return { decision, evidence: { ...evidence, validation: "accepted", decision } };
  }

  private contractError(evidence: LlmEvidence & { content: string }, reason: string): LlmContractError {
    const { content: _content, ...safeEvidence } = evidence;
    void _content;
    safeEvidence.validation = "rejected"; safeEvidence.rejectionReason = reason;
    return new LlmContractError(reason, safeEvidence);
  }

  private async fetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    let response: Response;
    try { response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs), headers: { "content-type": "application/json", ...(init.headers ?? {}) } }); }
    catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") throw new LlmContractError(`request deadline ${timeoutMs}ms`);
      throw new RetryableProviderError(error instanceof Error ? error.message : "connection reset");
    }
    if ([500, 502, 503, 504].includes(response.status)) throw new RetryableProviderError(`HTTP ${response.status}`);
    if (!response.ok) throw new LlmContractError(`HTTP ${response.status}`);
    return response;
  }

  private async complete(payload: object, preflightAttempt: number): Promise<LlmEvidence & { content: string; rawResponseSha256: string }> {
    const promptHash = sha256(JSON.stringify(payload));
    const requestBody = { model: this.config.llm.expectedModelId, temperature: this.config.llm.temperature, top_p: this.config.llm.topP, seed: this.config.seed, ...payload };
    let lastRetry = "";
    for (let attempt = 1; attempt <= this.config.llm.maxRetries + 1; attempt += 1) {
      const started = performance.now();
      try {
        const response = await this.fetch(endpoint(this.config, "chat/completions"), { method: "POST", body: JSON.stringify(requestBody) }, this.config.llm.connectTimeoutMs);
        const incoming = await readResponse(response, started, this.config.llm.requestTimeoutMs);
        const parsed = responseContent(incoming.raw, response.headers.get("content-type") ?? "application/json");
        return {
          content: parsed.content, endpoint: this.config.llm.baseUrl, modelId: this.config.llm.expectedModelId, modelSha256: this.config.llm.modelSha256,
          runtime: this.config.llm.runtimeEvidence, promptHash, schemaHash, seed: this.config.seed, temperature: this.config.llm.temperature, topP: this.config.llm.topP,
          maxTokens: typeof (payload as { max_tokens?: number }).max_tokens === "number" ? (payload as { max_tokens: number }).max_tokens : this.config.llm.maxTokens,
          attempt, retryReason: lastRetry || undefined, httpStatus: response.status, requestTokens: undefined, responseTokens: parsed.responseTokens,
          ttftMs: incoming.ttftMs, totalLatencyMs: Math.round(performance.now() - started), rawResponseSha256: sha256(incoming.raw), redactedRequestSha256: sha256(redactJson(requestBody)), redactedResponseSha256: sha256(redactJson(parsed.content)), validation: "accepted",
        };
      } catch (error) {
        if (!(error instanceof RetryableProviderError) || attempt > this.config.llm.maxRetries) throw error;
        lastRetry = error.message;
        await sleep(attempt * 1_000);
      }
    }
    throw new LlmContractError(`completion失敗: ${preflightAttempt}`);
  }
}

export async function probeLlm(config: LakdaConfig): Promise<"available" | "unavailable"> {
  try {
    const response = await fetch(endpoint(config, "models"), { signal: AbortSignal.timeout(config.llm.connectTimeoutMs) });
    return response.ok ? "available" : "unavailable";
  } catch { return "unavailable"; }
}
