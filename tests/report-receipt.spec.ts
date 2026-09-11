import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, open, readFile, readdir, rm, symlink, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReportReceipt } from "../src/reporting/generation.js";
import { writeReportReceipt } from "../src/reporting/receipt-writer.js";

test("receipt publication never exposes partial JSON after a write failure or abort", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-receipt-"));
  const probePath = join(root, "probe"); const probe = await open(probePath, "wx");
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  const original = prototype.writeFile;
  await probe.close(); await rm(probePath);
  try {
    for (const fault of ["write-error", "abort"]) {
      const controller = new AbortController();
      const reason = Object.assign(new Error("fixture interrupted write"), { code: fault === "abort" ? "ABORT_ERR" : "ENOSPC" });
      prototype.writeFile = async function(this: FileHandle) {
        await this.write(Buffer.from('{"schemaVersion":'));
        if (fault === "abort") controller.abort(reason);
        throw reason;
      };
      const receipt = createReportReceipt("fixture", "local");
      await expect(writeReportReceipt(join(root, "report"), receipt, [], controller.signal)).rejects.toMatchObject({ code: reason.code });
      expect(await readdir(root)).toEqual([]);
    }
  } finally { prototype.writeFile = original; await rm(root, { recursive: true, force: true }); }
});

test("a completed receipt is exclusive and receipt failures preserve source directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-receipt-"));
  try {
    const source = join(root, "source"); await mkdir(source);
    const receipt = createReportReceipt("fixture", "local");
    const output = join(root, "report"); const path = join(root, receipt.reportId + ".receipt.json");
    await writeReportReceipt(output, receipt, [source]);
    const bytes = await readFile(path); expect(JSON.parse(bytes.toString())).toEqual(receipt);
    await expect(writeReportReceipt(output, receipt, [source])).rejects.toThrow();
    expect(await readFile(path)).toEqual(bytes);
    expect((await readdir(root)).sort()).toEqual([receipt.reportId + ".receipt.json", "source"].sort());
    const alias = join(root, "source-alias"); await symlink(source, alias, "junction");
    await expect(writeReportReceipt(join(alias, "report"), createReportReceipt("fixture", "local"), [source])).rejects.toMatchObject({ issueCode: "output-overlap" });
    const controller = new AbortController(); controller.abort();
    await expect(writeReportReceipt(output, createReportReceipt("fixture", "local"), [source], controller.signal)).rejects.toThrow();
    expect(await readdir(source)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
