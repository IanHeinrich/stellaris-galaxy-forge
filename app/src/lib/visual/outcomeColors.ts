import type { Outcome } from "../prepareCopy";

/** The ring the map draws round what Galaxy Forge places anew for the new game. */
export const OUTCOME_COLORS: Record<Outcome, number> = {
  seat: 0x4ade80,
  zone: 0xf59e0b,
};

/** Every mark's stroke. */
export const OUTCOME_STROKE = { width: 2.5, alpha: 0.9 };

/** The same colour as CSS writes it, for the legend. */
export function outcomeCss(outcome: Outcome): string {
  return `#${OUTCOME_COLORS[outcome].toString(16).padStart(6, "0")}`;
}
