import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

type Validator = (value: unknown) => boolean;
type AjvInstance = {
  addSchema(schema: object): void;
  getSchema(id: string): Validator | undefined;
};
type AjvConstructor = new (options: object) => AjvInstance;

const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as AjvConstructor;
const root = resolve(process.cwd());
const schemaFiles = readdirSync(resolve(root, "schemas"))
  .filter(name => name.endsWith(".schema.json"))
  .sort();

test("every public schema is registered and compiles with the packaged HATE dependency", () => {
  expect(schemaFiles.length).toBeGreaterThan(20);
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    formats: { uri: true, "date-time": true },
  });
  const hate = JSON.parse(readFileSync(resolve(root, "vendor", "hate", "v1", "artifact-manifest.schema.json"), "utf8")) as { $id?: string };
  ajv.addSchema(hate);
  const schemas = schemaFiles.map(name => ({
    name,
    value: JSON.parse(readFileSync(resolve(root, "schemas", name), "utf8")) as { $id?: string },
  }));
  for (const schema of schemas) {
    expect(schema.value.$id, schema.name + " must declare a stable $id").toBeTruthy();
    ajv.addSchema(schema.value);
  }
  for (const schema of schemas) {
    expect(() => ajv.getSchema(schema.value.$id!), schema.name + " must compile").not.toThrow();
    expect(ajv.getSchema(schema.value.$id!), schema.name + " must be retrievable").toBeDefined();
  }
});
