/** Where a list moves its highlight: to the first row when the highlighted one is not shown. */
export function fallbackHighlight<K extends string>(
  shown: readonly K[],
  highlighted: K | null,
): K | null {
  if (shown.length === 0) return null;
  return highlighted !== null && shown.includes(highlighted) ? null : shown[0];
}
