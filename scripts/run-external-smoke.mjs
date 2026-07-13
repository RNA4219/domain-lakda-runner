import { runExternalSmoke } from "../dist/external-smoke.js";

const result = await runExternalSmoke();
console.log(JSON.stringify(result, null, 2));
if ("outcome" in result) process.exitCode = result.outcome === "passed" ? 0 : result.outcome === "error" ? 1 : 2;