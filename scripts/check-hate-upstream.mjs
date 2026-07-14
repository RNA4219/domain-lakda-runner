import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const vendor = resolve("vendor/hate/v1/artifact-manifest.schema.json");
const upstream = JSON.parse(await readFile(resolve("vendor/hate/v1/UPSTREAM.json"), "utf8"));
const digest = value => createHash("sha256").update(value).digest("hex");
const vendorBytes = await readFile(vendor);
if (digest(vendorBytes) !== upstream.sha256) throw new Error("vendored HATE schema hash does not match UPSTREAM.json");

const requireUpstream = process.argv.includes("--require-upstream");
const upstreamRepo = process.env.HATE_UPSTREAM_REPO;
const sourceOverride = process.env.HATE_UPSTREAM_SCHEMA;
if (requireUpstream && !upstreamRepo) throw new Error("release checkにはHATE_UPSTREAM_REPOが必要です");
let upstreamRevision;
let upstreamBytes;
if (upstreamRepo) {
  upstreamRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: upstreamRepo, encoding: "utf8" }).trim();
  if (upstreamRevision !== upstream.commit) throw new Error("HATE upstream repoが固定commitにcheckoutされていません");
  upstreamBytes = execFileSync("git", ["show", `${upstream.commit}:${upstream.sourcePath}`], { cwd: upstreamRepo });
}
if (upstreamBytes && !vendorBytes.equals(upstreamBytes)) throw new Error("vendored HATE schema differs from fixed upstream Git blob");
if (sourceOverride) {
  const overrideBytes = await readFile(sourceOverride);
  if (!vendorBytes.equals(overrideBytes)) throw new Error("vendored HATE schema differs from explicit upstream source");
}
const result = {
  schema: "HATE/v1",
  commit: upstream.commit,
  sha256: upstream.sha256,
  pinnedChecked: true,
  upstreamChecked: Boolean(upstreamBytes && upstreamRevision),
  upstreamRevision,
};
if (requireUpstream && !result.upstreamChecked) throw new Error("HATE upstream検証が完了していません");
console.log(JSON.stringify(result));
