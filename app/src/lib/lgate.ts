import type { LGate } from "../generated/LGate";
import type { LGateOutcome } from "../generated/LGateOutcome";

/** What the game calls each outcome `distar.8000` can roll on day one. */
export const LGATE_OUTCOME_LABELS: Record<LGateOutcome, string> = {
  gray_tempest: "Gray Tempest",
  l_drakes: "L-Drakes",
  dessanu_consonance: "Dessanu Consonance",
  empty: "Empty cluster",
};

/** The outcome's label, plus ", opened" once a gate has been used. */
export function lgateOutcomeLine(lgate: LGate): string {
  const label = LGATE_OUTCOME_LABELS[lgate.outcome];
  return lgate.opened ? `${label}, opened` : label;
}

/** The outcomes in the order the dropdown offers them. */
export const LGATE_OUTCOMES = Object.keys(LGATE_OUTCOME_LABELS) as LGateOutcome[];

export const LGATE_OPENED_TITLE = "A gate has opened: the outcome has already spawned";

export const LGATE_TEMPEST_NOTE =
  "Chosen by hand, the Gray Tempest ignores the game rule that keeps disruptive outcomes out.";
