/** An identifier the game would show only through localisation, such as `HUMAN2_SYS` or `NGC`. */
function looksLikeKey(word: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*$/.test(word) && (word.includes("_") || !/[a-z]/.test(word));
}

/**
 * What an undo description calls a system, as the core's does: `Ferragon #489`, or `system #489`
 * when `name` is empty or, for a name with no localised text, a word of it still reads as a key.
 * `localised` says `name` is text a player reads, so it is not checked.
 */
export function systemLabel(name: string, id: number, localised: boolean): string {
  const unusable = name === "" || (!localised && name.split(" ").some(looksLikeKey));
  return unusable ? `system #${id}` : `${name} #${id}`;
}
