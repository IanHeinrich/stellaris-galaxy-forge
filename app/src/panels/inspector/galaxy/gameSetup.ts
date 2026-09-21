import type { HeaderField } from "../../../generated/HeaderField";
import type { Op } from "../../../generated/Op";
import { setHeaderField } from "./header";

/** Why a cell the grid cannot read as a number is text, shown on hover. */
export const RAW_CELL_TITLE = "Edit this key in Scenario header below";

/** What clearing a cell does, shown on hover: the raw list no longer holds the key's remove control. */
export const CLEAR_KEY_TITLE = "Clear to drop the key";
export const CLEAR_RANGE_TITLE = "Clear to drop the whole range";

/** One row of the grid: the label the new-game screen uses, and the header keys it reads. */
export type SetupRow = {
  label: string;
  /** The key written `{ min = A max = B }`. */
  range?: string;
  /** The key holding the max as a plain number, for a row without a range key. */
  max?: string;
  /** The key holding the default as a plain number. */
  default?: string;
  /** Whether the numbers may carry decimals. */
  decimals?: boolean;
};

export const SETUP_ROWS: readonly SetupRow[] = [
  { label: "AI empires", range: "num_empires", default: "num_empire_default" },
  { label: "Advanced starts", default: "advanced_empire_default" },
  { label: "Fallen empires", default: "fallen_empire_default", max: "fallen_empire_max" },
  { label: "Marauder empires", default: "marauder_empire_default", max: "marauder_empire_max" },
  { label: "Nomad empires", default: "nomad_empire_default", max: "nomad_empire_max" },
  { label: "Wormhole pairs", range: "num_wormhole_pairs", default: "num_wormhole_pairs_default" },
  { label: "Gateways", range: "num_gateways", default: "num_gateways_default" },
  {
    label: "Hyperlane density",
    range: "num_hyperlanes",
    default: "num_hyperlanes_default",
    decimals: true,
  },
];

/** What a scalar key reads as: a number the grid edits, nothing yet, or text only the raw list edits. */
export type Reading =
  { kind: "number"; value: number } | { kind: "missing" } | { kind: "raw"; text: string };

export type RangeReading =
  | { kind: "bounds"; min: number; max: number }
  | { kind: "missing" }
  | { kind: "raw"; text: string };

export type SetupView = {
  row: SetupRow;
  range: RangeReading | null;
  max: Reading | null;
  default: Reading | null;
  hints: string[];
};

const RANGE = /^\{\s*min\s*=\s*([^\s{}=]+)\s*max\s*=\s*([^\s{}=]+)\s*\}$/;
const INTEGER = /^-?\d+$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;

function parseNumber(text: string, decimals: boolean): number | null {
  return (decimals ? DECIMAL : INTEGER).test(text.trim()) ? Number(text) : null;
}

/** The bounds of `{ min = A max = B }`, spaces or not; null for anything else. */
export function parseRange(text: string, decimals = false): { min: number; max: number } | null {
  const match = RANGE.exec(text.trim());
  if (match === null) return null;
  const min = parseNumber(match[1], decimals);
  const max = parseNumber(match[2], decimals);
  return min === null || max === null ? null : { min, max };
}

export function formatRange(min: number, max: number): string {
  return `{ min = ${formatNumber(min)} max = ${formatNumber(max)} }`;
}

export function formatNumber(value: number): string {
  return String(value);
}

/** The text under `key` when the file states it once; a repeated key stays raw, with its duplicate mark. */
function statement(
  header: readonly HeaderField[],
  key: string,
): { text: string; once: boolean } | null {
  const found = header.filter((field) => field.key === key);
  if (found.length === 0) return null;
  return { text: found[0].value, once: found.length === 1 };
}

function readScalar(header: readonly HeaderField[], key: string, decimals: boolean): Reading {
  const read = statement(header, key);
  if (read === null) return { kind: "missing" };
  const value = read.once ? parseNumber(read.text, decimals) : null;
  return value === null ? { kind: "raw", text: read.text } : { kind: "number", value };
}

function readRange(header: readonly HeaderField[], key: string, decimals: boolean): RangeReading {
  const read = statement(header, key);
  if (read === null) return { kind: "missing" };
  const bounds = read.once ? parseRange(read.text, decimals) : null;
  return bounds === null ? { kind: "raw", text: read.text } : { kind: "bounds", ...bounds };
}

/** The min and max a row's default must sit between: its range, or 0 to its scalar max. */
function boundsOf(view: Pick<SetupView, "range" | "max">): { min: number; max: number } | null {
  if (view.range?.kind === "bounds") return { min: view.range.min, max: view.range.max };
  if (view.max?.kind === "number") return { min: 0, max: view.max.value };
  return null;
}

function hintsOf(row: SetupRow, view: Pick<SetupView, "range" | "max" | "default">): string[] {
  const hints: string[] = [];
  const bounds = boundsOf(view);
  if (bounds === null) return hints;
  if (bounds.max < bounds.min) hints.push(`${row.label} · Max is below min`);
  const value = view.default?.kind === "number" ? view.default.value : null;
  if (value !== null && (value < bounds.min || value > bounds.max)) {
    hints.push(
      `${row.label} · Default ${formatNumber(value)} is outside ${formatNumber(bounds.min)}–${formatNumber(bounds.max)}`,
    );
  }
  return hints;
}

/** Every row of the grid as `header` fills it. */
export function setupViews(header: readonly HeaderField[]): SetupView[] {
  return SETUP_ROWS.map((row) => {
    const decimals = row.decimals ?? false;
    const partial = {
      range: row.range === undefined ? null : readRange(header, row.range, decimals),
      max: row.max === undefined ? null : readScalar(header, row.max, decimals),
      default: row.default === undefined ? null : readScalar(header, row.default, decimals),
    };
    return { row, ...partial, hints: hintsOf(row, partial) };
  });
}

/** The keys the grid edits as numbers, which the raw list leaves out. */
export function handledKeys(header: readonly HeaderField[]): Set<string> {
  const keys = new Set<string>();
  for (const view of setupViews(header)) {
    if (view.range?.kind === "bounds" && view.row.range !== undefined) keys.add(view.row.range);
    if (view.max?.kind === "number" && view.row.max !== undefined) keys.add(view.row.max);
    if (view.default?.kind === "number" && view.row.default !== undefined) {
      keys.add(view.row.default);
    }
  }
  return keys;
}

/**
 * The text a count is written as: null for a decimal on an integer key, or a number `String`
 * would spell with an exponent, which the header writer would copy verbatim.
 */
export function formatCount(value: number, decimals: boolean): string | null {
  if (!Number.isFinite(value) || (!decimals && !Number.isInteger(value))) return null;
  const text = formatNumber(value);
  return text.includes("e") ? null : text;
}

/** Writes a plain count under `key`; null refuses a value the key cannot hold. */
export function setScalar(key: string, value: number, decimals = false): Op | null {
  const text = formatCount(value, decimals);
  return text === null ? null : setHeaderField(key, text);
}

/**
 * Writes one bound of the range `header` holds under `key` now, keeping the other as it reads at
 * this moment; a range not yet in the file starts with both bounds at the value committed. Null
 * refuses a value the key cannot hold, and a statement the grid cannot read.
 */
export function setBound(
  key: string,
  header: readonly HeaderField[],
  bound: "min" | "max",
  value: number,
  decimals = false,
): Op | null {
  const range = readRange(header, key, decimals);
  if (range.kind === "raw" || formatCount(value, decimals) === null) return null;
  const other = range.kind === "bounds" ? range[bound === "min" ? "max" : "min"] : value;
  const [min, max] = bound === "min" ? [value, other] : [other, value];
  return setHeaderField(key, formatRange(min, max));
}
