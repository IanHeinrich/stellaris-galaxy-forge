import type { Symmetry } from "../../store/toolStore";

export interface SymmetryChoice {
  value: string;
  label: string;
  /** What the rail button and the flyout show for it. */
  short: string;
  symmetry: Symmetry;
}

export const SYMMETRY_OFF: SymmetryChoice = {
  value: "off",
  label: "Off",
  short: "Off",
  symmetry: { kind: "off" },
};

export const MIRRORS: readonly SymmetryChoice[] = [
  {
    value: "mirror-y",
    label: "Mirror left–right",
    short: "↔",
    symmetry: { kind: "mirror", axis: "y" },
  },
  {
    value: "mirror-x",
    label: "Mirror top–bottom",
    short: "↕",
    symmetry: { kind: "mirror", axis: "x" },
  },
];

export const ROTATIONS: readonly SymmetryChoice[] = ([2, 3, 4, 6, 8] as const).map(
  (n): SymmetryChoice => ({
    value: `rotate-${n}`,
    label: `${n}-fold rotation`,
    short: `${n}`,
    symmetry: { kind: "rotate", n },
  }),
);

export function choiceOf(symmetry: Symmetry): SymmetryChoice {
  const value =
    symmetry.kind === "off"
      ? "off"
      : symmetry.kind === "mirror"
        ? `mirror-${symmetry.axis}`
        : `rotate-${symmetry.n}`;
  return [...MIRRORS, ...ROTATIONS].find((c) => c.value === value) ?? SYMMETRY_OFF;
}
