import { readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { ArtifactVideoMode, RunOutcome } from "./types.js";

const screenshotMaskStyle = '[data-lakda-sensitive], input[type="password"], input[name*="token" i], input[name*="secret" i] { color: transparent !important; text-shadow: 0 0 12px #000 !important; background: #000 !important; }';

export function videoRecordingOptions(mode: ArtifactVideoMode, runDir: string): { dir: string } | undefined {
  return mode === false ? undefined : { dir: join(runDir, "artifacts", "video") };
}

export function shouldRetainVideo(mode: ArtifactVideoMode, outcome: RunOutcome): boolean {
  return mode === true || (mode === "retain-on-non-pass" && outcome !== "passed");
}

export async function finalizeVideoCapture(mode: ArtifactVideoMode, runDir: string): Promise<void> {
  if (mode === false) return;
  const directory = join(runDir, "artifacts", "video");
  let files: string[];
  try {
    files = (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith(".webm"))
      .map(entry => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const staged = files.map((_file, index) => `.lakda-video-${String(index + 1).padStart(4, "0")}.tmp`);
  for (let index = 0; index < files.length; index += 1) await rename(join(directory, files[index]!), join(directory, staged[index]!));
  for (let index = 0; index < staged.length; index += 1) await rename(join(directory, staged[index]!), join(directory, `${String(index + 1).padStart(4, "0")}.webm`));
}

export async function applyVideoRetention(mode: ArtifactVideoMode, outcome: RunOutcome, runDir: string, retainForFinding = false): Promise<void> {
  if (mode === "retain-on-non-pass" && outcome === "passed" && !retainForFinding) {
    await rm(join(runDir, "artifacts", "video"), { recursive: true, force: true });
  }
}

export async function captureFailureScreenshot(context: BrowserContext, preferredPage: Page | undefined, path: string): Promise<void> {
  const page = preferredPage && !preferredPage.isClosed()
    ? preferredPage
    : context.pages().filter(candidate => !candidate.isClosed()).at(-1);
  if (!page) throw new Error("screenshot target is unavailable");
  try { await page.addStyleTag({ content: screenshotMaskStyle }); }
  catch (error) { throw new Error(`screenshot masking failed: ${error instanceof Error ? error.message : "unknown"}`, { cause: error }); }
  await page.screenshot({ path, fullPage: true });
}
