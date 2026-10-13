import { expect, it } from "vitest";
import { readTree } from "./test/files";

const SOURCES = readTree(
  import.meta.dirname,
  (path) =>
    /\.tsx?$/.test(path) &&
    !/^(generated|test)\//.test(path) &&
    !/(^|\/)__mocks__\//.test(path) &&
    !/\.test\.tsx?$/.test(path),
);

/** Shared test builders that are not test files by name. */
const TEST_SUPPORT = /fixture/i;

/**
 * Where a kind check belongs: the table of kinds and the capabilities it hands out, and the Open
 * dialog, which asks which kind of file a row on disk is, not what the open document can do.
 */
const KIND_SEAM = [
  "lib/documentKinds.ts",
  "lib/capabilities.ts",
  "lib/openRows.ts",
  "panels/file/OpenDetails.tsx",
  "panels/file/OpenRows.tsx",
  "panels/file/OpenSave.tsx",
];

/** Today's kind checks, each with the batch that turns it into a capability read. */
const KIND_OFFENDERS: Record<string, string> = {};

const KIND_COMPARISON = [
  /kind\s*[!=]==?\s*["'](save|scenario)["']/i,
  /["'](save|scenario)["']\s*[!=]==?\s*[\w.?]*kind\b/i,
];
const KIND_SWITCH = /\bswitch\s*\([^)]*kind\s*\)/i;
const ANY_SWITCH = /\bswitch\s*\(/;
const KIND_CASE = /\bcase\s+["'](save|scenario)["']/;

/** The lines of `source` that compare a kind, or are a save or scenario case of a switch on one. */
function kindChecks(source: string): [number, string][] {
  const checks: [number, string][] = [];
  let inKindSwitch = false;
  source.split("\n").forEach((line, i) => {
    if (ANY_SWITCH.test(line)) inKindSwitch = KIND_SWITCH.test(line);
    const compares = KIND_COMPARISON.some((check) => check.test(line));
    if (compares || (inKindSwitch && KIND_CASE.test(line))) checks.push([i + 1, line.trim()]);
  });
  return checks;
}

it("asks the document's capabilities, not its kind, outside the kind table", () => {
  const found = new Set<string>();
  const unlisted: string[] = [];
  for (const [file, source] of Object.entries(SOURCES)) {
    if (TEST_SUPPORT.test(file) || KIND_SEAM.includes(file)) continue;
    for (const [number, line] of kindChecks(source)) {
      found.add(file);
      if (!(file in KIND_OFFENDERS)) unlisted.push(`app/src/${file}:${number}: ${line}`);
    }
  }
  const cleared = Object.keys(KIND_OFFENDERS).filter((file) => !found.has(file));
  expect(
    unlisted,
    "Ask the document's capabilities, not its kind (ADR 0004). These lines compare a kind",
  ).toEqual([]);
  expect(cleared, "These files no longer compare a kind: delete their KIND_OFFENDERS line").toEqual(
    [],
  );
});
