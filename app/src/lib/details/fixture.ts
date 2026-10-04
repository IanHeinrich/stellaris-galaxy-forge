/** The system, planet, fleet and country a details test starts from. */
import { VANILLA_SYSTEM_RADII } from "../../generated/constants";
import type { CountryNode } from "../../generated/CountryNode";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { SystemDetails } from "../../generated/SystemDetails";
import { countryNode, orbitClasses, orbitSystem } from "../../test/builders";
import { VANILLA_MOON_SCALE } from "./discs";
import type { GeometryFrame, GeometryIntent, Span } from "./orbitIntent";
import { systemLayout } from "./orbits";
import { SAVE_GEOMETRY } from "./saveGeometry";
export {
  systemDetails as details,
  fleetSummary as fleet,
  planetSummary as planet,
} from "../../test/builders";

export const COUNTRY: CountryNode = countryNode({
  id: 3,
  name: { key: "NAME_Earth", literal: false, variables: [] },
  name_key: "NAME_Earth",
  capital_system: null,
  system_count: 0,
  colors: ["blue", "black"],
  painted_border: "blue",
  painted_fill: "black",
  flag_icon: { category: "human", file: "flag_human_9.dds" },
  flag_background: { category: "backgrounds", file: "00_solid.dds" },
});

/** The bodies of `orbitSystem()`, in system 140. */
export const SYSTEM = 140;
export const STAR = 1;
export const PLANET = 2;
export const MOON = 3;
export const LONE = 5;
export const ASTEROID = 6;

export function frameOf(details: SystemDetails = orbitSystem()): GeometryFrame {
  const planetClasses = orbitClasses();
  const layout = systemLayout(details, null, planetClasses, VANILLA_MOON_SCALE);
  return { layout, details, planetClasses, radii: VANILLA_SYSTEM_RADII };
}

export const op = (intent: GeometryIntent, frame = frameOf()) => SAVE_GEOMETRY.op(intent, frame);

/** `body` as the core sends one the game placed a little off its stored orbit: drawn at `drawn`. */
export function drawnOff(body: PlanetSummary, drawn: number): PlanetSummary {
  return { ...body, layout: { ...body.layout!, orbit: { min: drawn, max: drawn } } };
}

export const move = (body: number, radius: Span, angle: number): GeometryIntent => ({
  kind: "move",
  system: SYSTEM,
  body,
  radius,
  angle,
});

export const reparent = (
  body: number,
  parent: number | null,
  radius = 25,
  angle = 0,
): GeometryIntent => ({
  kind: "reparent",
  system: SYSTEM,
  body,
  parent,
  radius,
  angle,
});
