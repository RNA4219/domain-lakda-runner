import { basename, resolve } from "node:path";
import { createRequire } from "node:module";
import { URL } from "node:url";

export function checkSchemas(root, io, markdownPaths = []) {
  const { readFileSync, readdirSync } = io;
  const failures = [];
  const require = createRequire(import.meta.url);
  const hateSchema = JSON.parse(readFileSync(resolve(root, "vendor/hate/v1/artifact-manifest.schema.json"), "utf8"));
  const Ajv = require("ajv/dist/2020").default;
  const hateValidate = new Ajv({ allErrors: true, strict: false }).compile(hateSchema);
  const schemaPaths = readdirSync(resolve(root, "schemas"))
    .filter(name => name.endsWith(".schema.json"))
    .sort()
    .map(name => "schemas/" + name);
  const schemaAjv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  const loadedSchemas = [];
  try {
    schemaAjv.addSchema(hateSchema);
    for (const schemaPath of schemaPaths) {
      const schema = JSON.parse(readFileSync(resolve(root, schemaPath), "utf8"));
      schemaAjv.addSchema(schema, schemaPath);
      loadedSchemas.push([schemaPath, schema]);
    }
  } catch (error) {
    failures.push(`schema registry: load failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  function collectSchemaRefs(value, refs = []) {
    if (Array.isArray(value)) for (const item of value) collectSchemaRefs(item, refs);
    else if (value && typeof value === "object") {
      if (typeof value.$ref === "string") refs.push(value.$ref);
      for (const item of Object.values(value)) collectSchemaRefs(item, refs);
    }
    return refs;
  }
  for (const [, schema] of loadedSchemas) {
    if (typeof schema.$id !== "string") continue;
    for (const ref of collectSchemaRefs(schema)) {
      if (!ref.endsWith(".schema.json")) continue;
      const target = loadedSchemas.find(([schemaPath]) => schemaPath.endsWith("/" + ref));
      if (!target || typeof target[1].$id !== "string") continue;
      const aliasId = new URL(ref, schema.$id).href;
      if (!schemaAjv.getSchema(aliasId)) schemaAjv.addSchema({ $id: aliasId, $ref: target[1].$id });
    }
  }
  for (const [schemaPath, schema] of loadedSchemas) {
    try {
      const key = typeof schema.$id === "string" ? schema.$id : schemaPath;
      if (!schemaAjv.getSchema(key)) throw new Error("schema did not compile");
    } catch (error) {
      failures.push(`${schemaPath}: schema compile failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const path of markdownPaths) {
    const text = readFileSync(path, "utf8");
    for (const json of text.matchAll(/^```json\s*\r?\n([\s\S]*?)^```/gm)) {
      let value;
      try { value = JSON.parse(json[1]); } catch { continue; }
      if (value && value.schema_version === "HATE/v1" && !hateValidate(value)) failures.push(basename(path) + ": HATE/v1 example does not match vendor schema");
    }
  }
  return failures;
}
