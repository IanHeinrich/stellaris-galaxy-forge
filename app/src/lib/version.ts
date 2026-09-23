/** The number in a game version string, `"Cygnus v4.5.0"` -> `"4.5.0"`; null when it has none. */
export function versionNumber(version: string): string | null {
  return /\d+(?:\.\d+)+/.exec(version)?.[0] ?? null;
}

/** The version as a row names it, `"Pegasus v4.4.6"` -> `"v4.4.6"`; empty when it has no number. */
export function versionShort(version: string): string {
  const number = versionNumber(version);
  return number === null ? "" : `v${number}`;
}
