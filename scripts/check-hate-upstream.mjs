import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const vendor = resolve("vendor/hate/v1/artifact-manifest.schema.json");
const upstream = JSON.parse(await readFile(resolve("vendor/hate/v1/UPSTREAM.json"), "utf8"));
const digest = value => createHash("sha256").update(value).digest("hex");
const vendorBytes = await readFile(vendor);
if (digest(vendorBytes) !== upstream.sha256) throw new Error("vendored HATE schema hash does not match UPSTREAM.json");
const source = process.env.HATE_UPSTREAM_SCHEMA;
if (source) {
  const upstreamBytes = await readFile(source);
  if (!vendorBytes.equals(upstreamBytes)) throw new Error("vendored HATE schema differs from fixed upstream source");
}
console.log(JSON.stringify({ schema: "HATE/v1", commit: upstream.commit, sha256: upstream.sha256, upstreamChecked: Boolean(source) }));
