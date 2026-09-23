import { ROTATION_ORDERS, sameSymmetry, type Symmetry } from "../../lib/geometry/symmetry";

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

export const ROTATIONS: readonly SymmetryChoice[] = ROTATION_ORDERS.map((n): SymmetryChoice => ({
  value: `rotate-${n}`,
  label: `${n}-fold rotation`,
  short: `${n}`,
  symmetry: { kind: "rotate", n },
}));

export function choiceOf(symmetry: Symmetry): SymmetryChoice {
  return [...MIRRORS, ...ROTATIONS].find((c) => sameSymmetry(c.symmetry, symmetry)) ?? SYMMETRY_OFF;
}
