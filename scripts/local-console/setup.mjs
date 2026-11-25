import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
export const exampleDir = fileURLToPath(new URL("../../examples/e2e-platform/", import.meta.url));
export const sha = bytes => createHash("sha256").update(bytes).digest("hex");

export async function readJson(path) {
  const bytes = await readFile(path, "utf8").catch(error => {
    if (error.code === "ENOENT") throw new Error("ファイルが見つかりません " + path, { cause: error });
    throw error;
  });
  try { return JSON.parse(bytes.replace(/^\uFEFF/, "")); }
  catch { throw new Error("JSON の形式を確認してください " + path); }
}

export async function gitHead(cwd) {
  try { return (await exec("git", ["rev-parse", "--verify", "HEAD"], { cwd, windowsHide: true })).stdout.trim(); }
  catch { throw new Error("Git と、コミット済みのチェックアウトを確認してください " + cwd); }
}

export async function initialize(file) {
  const dest = resolve(file);
  await mkdir(dirname(dest), { recursive: true });
  try { await copyFile(join(exampleDir, "product.config.json"), dest, constants.COPYFILE_EXCL); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error("設定ファイルは既に存在します " + dest, { cause: error });
    throw error;
  }
  return dest;
}

export async function readRegistration(cfg, base) {
  if (cfg.sources) {
    const input = resolve(base, cfg.sources);
    const seed = await readJson(input);
    if (!seed.overview || !Array.isArray(seed.records)) throw new Error("sources に overview と records が必要です");
    for (const item of seed.records) {
      for (const key of ["index", "caseDir", "runDir", "qegDir", "manualCaseSet", "featureSpec", "decisionEvidence"]) {
        if (item[key]) item[key] = resolve(dirname(input), item[key]);
      }
    }
    return seed;
  }
  if (!cfg.productName?.trim() || !cfg.target?.binding) throw new Error("設定に productName と target.binding が必要です");
  const { bindingVersion, target } = await readJson(resolve(base, cfg.target.binding));
  if (bindingVersion !== "qeg-build/v1") throw new Error("target.binding に qeg-build/v1 のビルド記録を指定してください");
  const overview = { name: cfg.productName, productId: target?.projectId, revision: target?.revision, environment: target?.environmentId };
  if (!overview.productId || !overview.environment || !/^(?!0{40}$)[0-9a-f]{40}$/.test(overview.revision)) {
    throw new Error("target.binding に製品 ID、対象コミット、環境 ID が必要です");
  }
  return { overview, records: [] };
}

// 同梱サンプルは固定した1画面だけを配信し、保存する replay も fixture として扱う。
export async function loadDemo(cfg, base) {
  const revision = await gitHead(base);
  const bytes = await readFile(resolve(base, cfg.target.directory, "index.html"));
  if (sha(bytes) !== cfg.target.indexSha256) throw new Error("サンプル画面が配布時の内容と異なります");
  return {
    seed: { overview: { productId: "shipping-demo", name: cfg.productName, revision, environment: "local-fixture" }, records: [] },
    files: new Map([["/index.html", bytes]]),
  };
}

export async function recordingTools(cfg) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(isAbsolute);
  async function candidates(name) {
    const supplied = cfg[name];
    if (supplied !== undefined && (typeof supplied !== "string" || !isAbsolute(supplied))) {
      throw new Error(name + " に実行ファイルの絶対パスを指定してください");
    }
    const found = [];
    for (const path of supplied ? [supplied] : dirs.map(dir => join(dir, name + suffix))) {
      try {
        await access(path, constants.X_OK);
        if ((await stat(path)).isFile()) found.push(path);
      } catch { /* PATH には使用できないディレクトリが含まれることがある。 */ }
    }
    if (!found.length) throw new Error(name + " が見つかりません。FFmpeg（libx264 を含む版）の bin を PATH に追加するか、設定に絶対パスを指定してください。");
    return found;
  }
  const encoders = await candidates("ffmpeg");
  const probes = await candidates("ffprobe");
  // 複数の FFmpeg が入っている PC では同じ配布物の組を優先する。
  const ffmpeg = encoders.find(path => probes.some(probe => dirname(path) === dirname(probe))) ?? encoders[0];
  const ffprobe = probes.find(path => dirname(path) === dirname(ffmpeg)) ?? probes[0];
  return { ffmpeg, ffprobe };
}

export async function checkReplayTools({ ffmpeg, ffprobe }) {
  const options = { timeout: 10_000, windowsHide: true };
  try {
    const { stdout } = await exec(ffmpeg, ["-hide_banner", "-encoders"], options);
    if (!/^\s*V\S*\s+libx264\s/m.test(stdout)) throw new Error();
  } catch { throw new Error("H.264 録画には libx264 を含む FFmpeg が必要です。確認したファイル " + ffmpeg); }
  try { await exec(ffprobe, ["-version"], options); }
  catch { throw new Error("ffprobe を起動できません。確認したファイル " + ffprobe); }
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    await browser.close();
  } catch (error) {
    throw new Error("Chromium を起動できません。npm ci と npm run platform:setup を実行してください。\n" + error.message.split("\n")[0], { cause: error });
  }
}
