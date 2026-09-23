import type { PrefKey } from "./prefKeys";

/** Preferences kept in `localStorage`; anything absent, unreadable or malformed falls back. */
export function readPref<T>(key: PrefKey, fallback: T, valid: (value: unknown) => value is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return valid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: PrefKey, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

/** One preference under its key: `read` falls back to `fallback` unless given another. */
export interface PrefField<T> {
  read(fallback?: T): T;
  save(value: T): void;
}

export function prefField<T>(
  key: PrefKey,
  fallback: T,
  valid: (value: unknown) => value is T,
): PrefField<T> {
  return {
    read: (instead = fallback) => readPref(key, instead, valid),
    save: (value) => writePref(key, value),
  };
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "boolean")
  );
}
