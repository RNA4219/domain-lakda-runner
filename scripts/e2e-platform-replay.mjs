import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { URL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { buildRecordingPlan } from "./e2e-recording-plan.mjs";

const help = `使い方
  node scripts/e2e-platform-replay.mjs --scenario-dir <dir> --case <id> --base-url <url>
    --plan <plan.json> --output-dir <dir> --ffmpeg <絶対パス> --ffprobe <絶対パス>
    [--observations <file>] [--input-profiles <json-file>] [--execution-mode real]

録画計画と承認済みのエクスポートを照合し、指定ケースだけを Chromium で実行します。
実行前に Lakda のルートで npm run build を実行してください。
観察対象を指定した計画は、作成時と同じ観察ファイルを使います。
`;
const required = ["scenario-dir", "case", "base-url", "plan", "output-dir", "ffmpeg", "ffprobe"];
const optional = ["observations", "input-profiles", "execution-mode"];

class PreflightError extends Error {}

function argumentsForReplay() {
  const options = Object.fromEntries([...required, ...optional].map(key => [key, { type: "string" }]));
  const { values, tokens } = parseArgs({ options: { ...options, help: { type: "boolean" } }, tokens: true });
  const names = tokens.filter(token => token.kind === "option").map(token => token.name);
  if (new Set(names).size !== names.length) throw new Error();
  if (values.help === true && names.length === 1) return null;
  if (values.help || required.some(key => !values[key]) || names.some(key => !values[key]) ||
      !isAbsolute(values.ffmpeg) || !isAbsolute(values.ffprobe) ||
      (values["execution-mode"] !== undefined && values["execution-mode"] !== "real")) throw new Error();
  return values;
}

async function checkedBytes(path, expectedDigest) {
  const bytes = await readFile(path);
  if (createHash("sha256").update(bytes).digest("hex") !== expectedDigest) {
    throw new PreflightError("計画作成後にケースの入力が変更されています");
  }
  return bytes;
}

function checkInputProfiles(supplied, actions) {
  const expected = new Set(actions.map(action => action.inputProfileId).filter(value => value !== undefined));
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied) ||
      Object.keys(supplied).length !== expected.size ||
      [...expected].some(key => !Object.hasOwn(supplied, key) || typeof supplied[key] !== "string")) {
    throw new PreflightError("入力プロファイルと操作列の参照が一致しません");
  }
}

async function replay() {
  let args;
  try { args = argumentsForReplay(); }
  catch { throw new PreflightError("コマンド引数が不正です。--help で使い方を確認できます"); }
  if (!args) { process.stdout.write(help); return 0; }

  const { configFromJson } = await import("../dist/core/config.js");
  let recording, actionPath, config, configBytes;
  try {
    const [stored, current] = await Promise.all([
      readFile(args.plan, "utf8").then(JSON.parse),
      buildRecordingPlan(args["scenario-dir"], args["base-url"], args.observations),
    ]);
    if (!isDeepStrictEqual(stored, current)) throw new PreflightError("録画計画が現在のケースまたは観察対象と一致しません");
    recording = current.cases.find(item => item.caseId === args.case);
    if (!recording) throw new PreflightError("対象ケースが録画計画にありません");

    const folder = resolve(args["scenario-dir"], recording.caseId);
    actionPath = join(folder, "action-sequence.json");
    const [approvedConfig, approvedActions] = await Promise.all([
      checkedBytes(join(folder, "lakda.config.json"), recording.configSha256),
      checkedBytes(actionPath, recording.actionSha256),
    ]);
    configBytes = approvedConfig;
    const input = JSON.parse(configBytes.toString("utf8"));
    const actions = JSON.parse(approvedActions.toString("utf8"));
    if (input.reviewedE2E !== true || actions.baseUrl !== new URL(args["base-url"]).href) {
      throw new PreflightError("操作列または対象 URL が承認済みケースに一致しません");
    }
    const profiles = args["input-profiles"]
      ? JSON.parse(await readFile(args["input-profiles"], "utf8"))
      : input.inputProfiles ?? {};
    checkInputProfiles(profiles, actions.actions);
    config = configFromJson(input, { mode: "regression-replay", baseUrl: actions.baseUrl,
      outputDir: resolve(args["output-dir"]), inputProfiles: profiles });
  } catch (error) {
    if (error instanceof PreflightError) throw error;
    throw new PreflightError("エクスポート・録画計画・設定または観察入力を検証できません");
  }

  const { runLakda } = await import("../dist/core/runner.js");
  const { createPlatformMediaProcessor } = await import("./e2e-platform-media.mjs");
  const processor = await createPlatformMediaProcessor({ ffmpeg: args.ffmpeg, ffprobe: args.ffprobe });
  const result = await runLakda(config, actionPath, {
    platformRecording: { plan: { ...recording, policyVersion: "1" }, configBytes, process: processor },
    ...(args["execution-mode"] === "real" ? { replayEvidenceMode: "real" } : {}),
  });
  process.stdout.write(JSON.stringify(result) + "\n");
  return result.exitCode;
}

try {
  process.exitCode = await replay();
} catch (error) {
  if (error instanceof PreflightError) {
    process.stderr.write(error.message + "\n");
    process.exitCode = 2;
  } else {
    process.stderr.write("プラットフォームの起動に失敗しました。Lakda のビルドと録画ツールを確認してください\n");
    process.exitCode = 1;
  }
}
