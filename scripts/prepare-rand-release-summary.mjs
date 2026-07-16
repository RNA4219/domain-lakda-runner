import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { findSensitive } from "../dist/core/redaction.js";

function flag(name) {
  return process.argv.slice(2).find(value => value.startsWith("--" + name + "="))?.slice(name.length + 3);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const required = ["revision", "tool-revision", "packet", "handoff", "out"];
const values = Object.fromEntries(required.map(name => [name, flag(name)]));
const missing = required.filter(name => !values[name]);
if (missing.length) throw new Error("不足している引数: " + missing.join(", "));
if (!/^[0-9a-f]{40}$/i.test(values.revision)) throw new Error("revisionは40桁Git SHAが必要です");
if (!/^[0-9a-f]{40}$/i.test(values["tool-revision"])) throw new Error("tool-revisionは40桁Git SHAが必要です");

const packetPath = resolve(values.packet);
const handoffPath = resolve(values.handoff);
const packet = await readFile(packetPath, "utf8");
const handoff = await readFile(handoffPath, "utf8");
const packetPayload = JSON.parse(packet);
const handoffPayload = JSON.parse(handoff);
if (!packetPayload || typeof packetPayload !== "object" || Array.isArray(packetPayload)) throw new Error("RanD requirements audit packetはJSON objectである必要があります");
if (!handoffPayload || typeof handoffPayload !== "object" || Array.isArray(handoffPayload)) throw new Error("RanD downstream handoffはJSON objectである必要があります");

const summary = {
  schemaVersion: "lakda/rand-release-summary/v1",
  status: "ready",
  subjectRevision: values.revision,
  toolRevision: values["tool-revision"],
  requirementsAuditPacket: basename(packetPath),
  requirementsAuditPacketSha256: sha256(packet),
  downstreamHandoff: basename(handoffPath),
  downstreamHandoffSha256: sha256(handoff),
};
const text = JSON.stringify(summary, null, 2) + "\n";
if (findSensitive(text).length) throw new Error("RanD release summaryに機微情報が含まれています");
await writeFile(resolve(values.out), text, "utf8");
console.log(JSON.stringify(summary, null, 2));