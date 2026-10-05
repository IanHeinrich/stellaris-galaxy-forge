import type { Outcome } from "../prepareCopy";

/** The ring the map draws round a system for what the Prepare choices make of it. */
export const OUTCOME_COLORS: Record<Outcome, number> = {
  ordinary: 0x9ca3af,
  rolled: 0x60a5fa,
  seat: 0x4ade80,
  zone: 0xf59e0b,
};

/**
 * Each ring's stroke. Bare shell rolls nearly every system, so ordinary and rolled rings stay
 * faint, and the few new seats and zones stand out.
 */
export const OUTCOME_STROKES: Record<Outcome, { width: number; alpha: number }> = {
  ordinary: { width: 1, alpha: 0.3 },
  rolled: { width: 1, alpha: 0.3 },
  seat: { width: 2.5, alpha: 0.9 },
  zone: { width: 2.5, alpha: 0.9 },
};

/** The same colour as CSS writes it, for the legend. */
export function outcomeCss(outcome: Outcome): string {
  return `#${OUTCOME_COLORS[outcome].toString(16).padStart(6, "0")}`;
}
