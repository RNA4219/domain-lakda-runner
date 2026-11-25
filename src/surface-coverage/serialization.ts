import { readMeasurement } from "./report.js";
import type { Measurement } from "./observer.js";

/** JSON quoting distinguishes typed identifiers from free-text secret assignments.
 * The decoded identifier and its definition digest never change. All other text
 * still goes through the ordinary artifact redactor and final-byte security scan.
 */
export function serializeMeasurement(value: Measurement): string {
  return JSON.stringify(readMeasurement(value)).replace(/("(?:id|testId|testRevision)":)"([A-Za-z0-9_.:-]+)"/g,
    (_match, key: string, identifier: string) => key + '"' + identifier.replaceAll(":", "\\u003a").replaceAll("-", "\\u002d") + '"');
}
