import { createHash, randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { link, lstat, mkdtemp, mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { CDPSession, Page } from "playwright";
import { redact } from "./redaction.js";

export type PlatformRecordingPlan = {
  caseId: string; caseRevision: string; oracleRevision: string; reviewSha256: string;
  actionSha256: string; configSha256: string; profile: "standard" | "detail" | "motion" | "detail-motion";
  fps: 5 | 15; resolution: "fit-720p" | "viewport"; reasons: string[];
};
export type PlatformMediaInput = { frames: { path: string; offsetMs: number }[]; fps: 5 | 15;
  resolution: "fit-720p" | "viewport"; viewport: { width: number; height: number }; durationMs: number; outputPath: string };
export type PlatformMediaResult = { width: number; height: number; fps: number; durationMs: number; sizeBytes: number; sha256: string };
export type PlatformRecordingRuntime = { plan: PlatformRecordingPlan; configBytes: Uint8Array;
  process: (input: PlatformMediaInput) => Promise<PlatformMediaResult> };
type CapturedFrame = { path: string; timestampMs: number };
type CapturedAction = { sequence: number; actionId: string; timestampMs: number; page: boolean };

async function removeIfOwned(path: string, identity: Stats): Promise<void> {
  const current = await lstat(path).catch(() => undefined);
  if (current && current.dev === identity.dev && current.ino === identity.ino) await rm(path, { force: true });
}

async function createOwnedStage(path: string, bytes: Uint8Array): Promise<Stats> {
  const handle = await open(path, "wx");
  let identity: Stats | undefined;
  try {
    identity = await handle.stat();
    await handle.writeFile(bytes);
    return identity;
  } catch (error) {
    await handle.close();
    if (identity) await removeIfOwned(path, identity);
    throw error;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export function validatePlatformRecording(runtime: PlatformRecordingRuntime, replayBytes: Uint8Array | undefined): void {
  const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
  if (!replayBytes || digest(replayBytes) !== runtime.plan.actionSha256 ||
      digest(runtime.configBytes) !== runtime.plan.configSha256 || typeof runtime.process !== "function" ||
      ![5, 15].includes(runtime.plan.fps) || !["fit-720p", "viewport"].includes(runtime.plan.resolution)) {
    throw new Error("platform recording binding invalid");
  }
}

export class PlatformRecording {
  private readonly frames: CapturedFrame[] = [];
  private readonly actions: CapturedAction[] = [];
  private queue: Promise<void> = Promise.resolve();
  private failure: unknown;
  private firstResolve!: () => void;
  private readonly first = new Promise<void>(resolveFirst => { this.firstResolve = resolveFirst; });
  private started = false;
  private totalBytes = 0;
  private visibilityLost = false;
  private otherPageSeen = false;
  private constructor(private readonly session: CDPSession, private readonly page: Page,
    private readonly temp: string, private readonly runtime: PlatformRecordingRuntime,
    private readonly runDir: string, private readonly limit: number,
    private readonly runId: string, private readonly attempt: number) {}

  static async start(page: Page, runtime: PlatformRecordingRuntime, runDir: string, limit: number, runId: string, attempt: number): Promise<PlatformRecording> {
    const temp = await mkdtemp(join(dirname(runDir), ".lakda-recording-"));
    let session: CDPSession | undefined;
    let recording: PlatformRecording | undefined;
    try {
      session = await page.context().newCDPSession(page);
      const capture = new PlatformRecording(session, page, temp, runtime, runDir, limit, runId, attempt);
      recording = capture;
      if (page.context().pages().some(other => other !== page)) capture.otherPageSeen = true;
      page.context().on("page", other => { if (other !== page) capture.otherPageSeen = true; });
      session.on("Page.screencastVisibilityChanged", event => { if (!event.visible) capture.visibilityLost = true; });
      session.on("Page.screencastFrame", event => {
        capture.queue = capture.queue.then(async () => {
          try {
            const timestampMs = (event.metadata.timestamp ?? NaN) * 1000;
            if (!Number.isFinite(timestampMs)) throw new Error("recording frame timestamp missing");
            const bytes = Buffer.from(event.data, "base64");
            capture.totalBytes += bytes.length;
            if (!bytes.length || capture.totalBytes > capture.limit) throw new Error("recording limit exceeded");
            const path = join(temp, `${String(capture.frames.length).padStart(8, "0")}.jpg`);
            await writeFile(path, bytes, { flag: "wx" });
            capture.frames.push({ path, timestampMs });
            capture.firstResolve();
          } catch (error) {
            const safe = error instanceof Error && ["recording frame timestamp missing", "recording frame timestamp reversed", "recording limit exceeded"].includes(error.message) ? error.message : "recording frame write failed";
            capture.failure = new Error(safe); capture.firstResolve();
          }
          finally { await session!.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined); }
        });
      });
      await session.send("Page.startScreencast", { format: "jpeg", quality: 80, everyNthFrame: 1 });
      capture.started = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([capture.first, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("first recording frame unavailable")), 10_000); })]);
      } finally { if (timer) clearTimeout(timer); }
      if (capture.failure || !capture.frames.length) throw new Error("first recording frame unavailable");
      return capture;
    } catch (error) {
      if (session) { await session.send("Page.stopScreencast").catch(() => undefined); await session.detach().catch(() => undefined); }
      await recording?.queue;
      await rm(temp, { recursive: true, force: true });
      throw error;
    }
  }

  recordAction(sequence: number, actionId: string, startedAtMs: number, sameVisiblePage: boolean): void {
    this.actions.push({ sequence, actionId: redact(actionId), timestampMs: startedAtMs, page: sameVisiblePage && !this.page.isClosed() });
  }

  async finish(): Promise<void> {
    const outputPath = resolve(this.runDir, "artifacts", "video", "0001.mp4");
    try {
      if (!this.started || this.page.isClosed()) throw new Error("recording page unavailable");
      await this.session.send("Page.stopScreencast");
      await this.queue;
      if (this.failure) throw this.failure;
      if (!this.frames.length) throw new Error("recording frames unavailable");
      // CDP can deliver frames out of timestamp order. Preserve their measured
      // timestamps and present them chronologically to the media processor.
      this.frames.sort((a, b) => a.timestampMs - b.timestampMs);
      if (this.visibilityLost || this.otherPageSeen || await this.page.evaluate(() => document.visibilityState !== "visible")) {
        throw new Error("recording page alignment unavailable");
      }
      // Capture the actual final paint and hold it for at least one output frame.
      const lastFrame = await this.page.screenshot({ type: "jpeg", quality: 80 });
      const lastFrameMs = Date.now();
      if (!lastFrame.length || this.totalBytes + lastFrame.length > this.limit || lastFrameMs < this.frames.at(-1)!.timestampMs) throw new Error("recording final frame unavailable");
      const lastPath = join(this.temp, `${String(this.frames.length).padStart(8, "0")}.jpg`);
      await writeFile(lastPath, lastFrame, { flag: "wx" });
      this.frames.push({ path: lastPath, timestampMs: lastFrameMs });
      await new Promise(resolveWait => setTimeout(resolveWait, Math.ceil(1000 / this.runtime.plan.fps) + 10));
      const stoppedAtMs = Date.now();
      const firstMs = this.frames[0]!.timestampMs;
      const durationMs = stoppedAtMs - firstMs;
      if (!Number.isFinite(durationMs) || durationMs <= 0 || this.frames.at(-1)!.timestampMs > stoppedAtMs) throw new Error("recording interval invalid");
      const actions = this.actions.map(action => ({ sequence: action.sequence, actionId: action.actionId,
        offsetMs: action.page && action.timestampMs >= firstMs && action.timestampMs <= stoppedAtMs ? action.timestampMs - firstMs : null }));
      if (actions.some(action => action.offsetMs === null)) throw new Error("recording action alignment unavailable");
      const viewport = this.page.viewportSize();
      if (!viewport || viewport.width <= 0 || viewport.height <= 0) throw new Error("recording viewport unavailable");
      const stagedOutput = join(this.temp, "0001.mp4");
      const measured = await this.runtime.process({ frames: this.frames.map(frame => ({ path: frame.path, offsetMs: frame.timestampMs - firstMs })),
        fps: this.runtime.plan.fps, resolution: this.runtime.plan.resolution, viewport, durationMs, outputPath: stagedOutput });
      const file = await readFile(stagedOutput); const actual = await stat(stagedOutput);
      const hash = createHash("sha256").update(file).digest("hex");
      if (!file.length || actual.size !== measured.sizeBytes || hash !== measured.sha256 || measured.fps !== this.runtime.plan.fps ||
          !Number.isFinite(measured.durationMs) || measured.durationMs <= 0 || !Number.isInteger(measured.width) || !Number.isInteger(measured.height) ||
          measured.width <= 0 || measured.height <= 0) throw new Error("recording measurement invalid");
      const metadata = join(this.temp, "platform-recording.json");
      await writeFile(metadata, JSON.stringify({ schemaVersion: "lakda/platform-recording/v1",
        runId: this.runId, attempt: this.attempt, plan: this.runtime.plan, firstFrameAt: new Date(firstMs).toISOString(), stoppedAt: new Date(stoppedAtMs).toISOString(),
        viewport, measured, actions }, null, 2) + "\n", { flag: "wx" });
      const videoDir = join(this.runDir, "artifacts", "video");
      await mkdir(videoDir, { recursive: true });
      const nonce = randomUUID();
      const localVideo = join(videoDir, `.platform-${nonce}.tmp`);
      const localMetadata = join(this.runDir, `.platform-${nonce}.tmp`);
      let videoIdentity: Stats | undefined;
      let metadataIdentity: Stats | undefined;
      let publishedVideo = false;
      try {
        videoIdentity = await createOwnedStage(localVideo, file);
        metadataIdentity = await createOwnedStage(localMetadata, await readFile(metadata));
        await link(localVideo, outputPath);
        publishedVideo = true;
        await link(localMetadata, join(this.runDir, "platform-recording.json"));
      } catch (error) {
        if (publishedVideo && videoIdentity) await removeIfOwned(outputPath, videoIdentity);
        throw error;
      } finally {
        if (videoIdentity) await removeIfOwned(localVideo, videoIdentity);
        if (metadataIdentity) await removeIfOwned(localMetadata, metadataIdentity);
      }
    } finally {
      await this.session.detach().catch(() => undefined);
      await this.queue;
      await rm(this.temp, { recursive: true, force: true });
    }
  }
}
