import type { Capabilities } from "../../generated/Capabilities";

/** The steepest the tilt view leans the galaxy plane, in degrees. */
export const TILT_MAX_DEGREES = 60;

/** Stellaris's galaxy camera, from its GALAXY_MIN/MAX_PITCH defines and a measured screenshot. */
export const GAME_DEFAULT_TILT = 33;
export const GAME_TILT_RANGE = { min: 5, max: 60 } as const;
/** How close to the game's default angle a released Tilt slider snaps to it, in degrees. */
const GAME_TILT_SNAP = 1.5;

/** `degrees` as the Tilt slider can hold it: whole degrees from flat to `TILT_MAX_DEGREES`. */
export function clampTilt(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return Math.min(TILT_MAX_DEGREES, Math.max(0, Math.round(degrees)));
}

/** Where a Tilt slider let go at `degrees` settles: on the game's default angle when close to it. */
export function settledTilt(degrees: number): number {
  return Math.abs(degrees - GAME_DEFAULT_TILT) <= GAME_TILT_SNAP ? GAME_DEFAULT_TILT : degrees;
}

/** Whether the galaxy map can tilt: a save's, whose systems have heights. */
export function tiltAvailable(capabilities: Capabilities): boolean {
  return capabilities.system_heights;
}

/** The angle the galaxy map leans at: the slider's, where the map can tilt, else flat. */
export function shownTilt(degrees: number, capabilities: Capabilities): number {
  return tiltAvailable(capabilities) ? clampTilt(degrees) : 0;
}

/** What the map says while it leans and refuses moves and lane edits. */
export const TILT_HINT = "Tilted: moving systems and editing hyperlanes return at 0°";
