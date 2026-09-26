import type { RolledBody } from "../generated/RolledBody";
import type { SystemRoll } from "../generated/SystemRoll";

/** The one `SystemRoll` builder: roll 0 of system 1, placing nothing. */
export function systemRoll(over: Partial<SystemRoll> = {}): SystemRoll {
  return {
    system: 1,
    roll: 0,
    bodies: [],
    rolls_planets: false,
    placeholders: [],
    ...over,
  };
}

/** The one `RolledBody` builder: body 1 at the centre, turned from the walk's start. */
export function rolledBody(over: Partial<RolledBody> = {}): RolledBody {
  return { id: 1, orbit: 0, angle: 0, base: 0, from: 180, ...over };
}
