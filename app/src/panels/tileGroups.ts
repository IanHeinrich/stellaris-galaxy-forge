/** A tile group as the panel's dropdown lists it: groups without a section first, then each section's under its heading. */
export function groupItems(
  groups: readonly { key: string; label: string; section?: string; note?: string }[],
): { key: string; label: string; group?: string; note?: string }[] {
  const sections = [...new Set(groups.map((g) => g.section))].filter((s) => s !== undefined);
  const item = (g: (typeof groups)[number]) => ({
    key: g.key,
    label: g.label,
    group: g.section,
    note: g.note,
  });
  return [
    ...groups.filter((g) => g.section === undefined).map(item),
    ...sections.flatMap((section) => groups.filter((g) => g.section === section).map(item)),
  ];
}
