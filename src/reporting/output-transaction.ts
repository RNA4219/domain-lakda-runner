import { link, lstat, mkdir, mkdtemp, open, realpath, rename, rm, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { sha256 } from "../core/redaction.js";
import { isContained } from "../runs/catalog-values.js";
import { ReportInputError } from "./contracts.js";

async function absent(path: string): Promise<void> {
  try { await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  throw new ReportInputError("output-exists", "レポート出力先は既に存在します");
}

export async function canonicalFutureDirectory(path: string): Promise<string> {
  try {
    const current = await lstat(path);
    const actual = await realpath(path);
    if (!current.isDirectory() && !current.isSymbolicLink() || !(await lstat(actual)).isDirectory()) throw new ReportInputError("invalid-output", "出力の親directoryが不正です");
    return actual;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(path) === path) throw error;
    return join(await canonicalFutureDirectory(dirname(path)), basename(path));
  }
}

export async function reserveReportOutput(outputDirectory: string, sourceRoots: string[], signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!outputDirectory || outputDirectory.includes("\0")) throw new ReportInputError("invalid-output", "出力directoryを指定してください");
  const requested = resolve(outputDirectory);
  const parent = await canonicalFutureDirectory(dirname(requested));
  const output = join(parent, basename(requested));
  for (const source of sourceRoots) {
    signal?.throwIfAborted();
    const root = await realpath(source);
    if (isContained(root, output) || isContained(output, root)) throw new ReportInputError("output-overlap", "レポート出力先が入力と重なっています");
  }
  await absent(output);
  signal?.throwIfAborted();
  await mkdir(parent, { recursive: true });
  if (await realpath(parent) !== parent) throw new ReportInputError("output-escape", "出力の親directoryが変更されています");
  const parentStat = await lstat(parent);
  const lockPath = join(parent, ".lakda-report-" + sha256(output.toLowerCase()) + ".lock");
  signal?.throwIfAborted();
  const lock = await open(lockPath, "wx").catch(error => {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ReportInputError("output-busy", "同じ出力先でレポートを生成中です");
    throw error;
  });
  const lockStat = await lock.stat();
  let stage: string | undefined;
  let stageStat: Awaited<ReturnType<typeof lstat>> | undefined;
  let published = false;
  const checkParent = async () => {
    const current = await lstat(parent);
    if (current.dev !== parentStat.dev || current.ino !== parentStat.ino || current.isSymbolicLink() || await realpath(parent) !== parent) throw new ReportInputError("output-escape", "出力の親directoryが変更されています");
  };
  const checkStage = async () => {
    const current = await lstat(stage!);
    if (!stageStat || current.dev !== stageStat.dev || current.ino !== stageStat.ino || current.isSymbolicLink() || await realpath(stage!) !== stage) throw new ReportInputError("output-escape", "作業directoryが変更されています");
  };
  const dispose = async () => {
    const errors: unknown[] = [];
    try {
      await checkParent();
      if (stage && !published) {
        const current = await lstat(stage);
        if (!stageStat || dirname(stage) !== parent || !isContained(parent, stage) || current.isSymbolicLink() || current.dev !== stageStat.dev || current.ino !== stageStat.ino || await realpath(stage) !== stage) throw new ReportInputError("output-escape", "作業directoryが変更されたため自動削除できません");
        await rm(stage, { recursive: true });
      }
    } catch (error) { errors.push(error); }
    try {
      await lock.close();
      await checkParent();
      const current = await lstat(lockPath);
      if (current.dev !== lockStat.dev || current.ino !== lockStat.ino || current.isSymbolicLink()) throw new ReportInputError("output-escape", "出力予約fileが変更されています");
      await unlink(lockPath);
    } catch (error) { errors.push(error); }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "レポート作業directoryと出力予約の後処理に失敗しました");
  };
  try {
    await absent(output);
    signal?.throwIfAborted();
    stage = await mkdtemp(join(parent, ".lakda-report-stage-"));
    stageStat = await lstat(stage);
    return { output, stage, dispose, publish: async () => {
      signal?.throwIfAborted();
      await checkParent();
      await checkStage();
      await absent(output);
      signal?.throwIfAborted();
      await rename(stage!, output);
      published = true;
    }, publishFile: async (name: string) => {
      signal?.throwIfAborted();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new ReportInputError("invalid-output", "公開file名が不正です");
      await checkParent(); await checkStage();
      const path = join(stage!, name); const current = await lstat(path);
      if (!current.isFile() || current.isSymbolicLink() || await realpath(path) !== path) throw new ReportInputError("output-escape", "公開fileが不正です");
      await absent(output);
      signal?.throwIfAborted();
      // link is an atomic no-replace publication; dispose still removes our stage.
      await link(path, output);
    } };
  } catch (error) { await dispose(); throw error; }
}
