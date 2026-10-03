import type { Capabilities } from "../../generated/Capabilities";

/** The steepest the tilt view leans the galaxy plane, in degrees. */
export const TILT_MAX_DEGREES = 60;

/** `degrees` as the Tilt slider can hold it: whole degrees from flat to `TILT_MAX_DEGREES`. */
export function clampTilt(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return Math.min(TILT_MAX_DEGREES, Math.max(0, Math.round(degrees)));
}

/** Whether the galaxy map can tilt: a save's, with the Heights layer on. */
export function tiltAvailable(heightsOn: boolean, capabilities: Capabilities): boolean {
  return heightsOn && capabilities.system_heights;
}

/** The angle the galaxy map leans at: the slider's, where the map can tilt, else flat. */
export function shownTilt(degrees: number, heightsOn: boolean, capabilities: Capabilities): number {
  return tiltAvailable(heightsOn, capabilities) ? clampTilt(degrees) : 0;
}

/** What the map says while it leans and takes no edits. */
export const TILT_HINT = "Tilted: view only, editing returns at 0°";
