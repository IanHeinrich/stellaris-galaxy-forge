import type { LGate } from "../generated/LGate";
import type { LGateModTouch } from "../generated/LGateModTouch";
import type { LGateOutcome } from "../generated/LGateOutcome";
import type { LGateTouchKind } from "../generated/LGateTouchKind";

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

/** How many mods a `LGateModWarnings` list names before it folds the rest into "and N more". */
export const LGATE_MOD_WARNING_LIMIT = 3;

/** What one touch does, in plain words, with the definition or flag it names. */
function lgateTouchDescription(kind: LGateTouchKind): string {
  switch (kind.type) {
    case "overrides_roll":
      return "overrides the day-one roll (distar.8000)";
    case "overrides_gate_opening":
      return "overrides the gate opening (distar.10950)";
    case "sets_flag":
      return `sets ${kind.flag}`;
    case "removes_flag":
      return `removes ${kind.flag}`;
    case "reads_flag":
      return `reads ${kind.flag}`;
  }
}

/** One mod's warning: the line to show and the title listing what each of its files does. */
export interface LGateModWarning {
  mod: string;
  title: string;
}

/** `touches` grouped by mod, in the order they first appear, for the row's warning lines. */
export function lgateModWarnings(touches: readonly LGateModTouch[]): LGateModWarning[] {
  const byMod = new Map<string, LGateModTouch[]>();
  for (const touch of touches) {
    const forMod = byMod.get(touch.mod_name);
    if (forMod) forMod.push(touch);
    else byMod.set(touch.mod_name, [touch]);
  }
  return [...byMod].map(([mod, touches]) => ({
    mod,
    title: touches.map((t) => `${t.file}: ${lgateTouchDescription(t.what)}`).join("; "),
  }));
}

/** The line a mod's warning shows: the outcome may not be what the dropdown says. */
export function lgateModWarningLine(mod: string): string {
  return `${mod} also changes the L-Gate outcome, so the game may not follow this choice.`;
}
