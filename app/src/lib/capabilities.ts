import type { Capabilities } from "../generated/Capabilities";

/** What a `.sav` supports: every save edit, but no scenario statements and no symmetry. */
export const SAVE_CAPABILITIES: Capabilities = {
  empires: true,
  details: true,
  lane_lengths: true,
  nebulae: true,
  bypasses: true,
  special: true,
  create_systems: false,
  lane_bridges: true,
  waylines: true,
  added_systems: true,
  bodies: true,
  deposits: true,
  map_colors: true,
  lgate: true,
  symmetry: false,
};

/** What a static galaxy scenario supports: scripted empires and system statements, no lengths. */
export const SCENARIO_CAPABILITIES: Capabilities = {
  empires: true,
  details: false,
  lane_lengths: false,
  nebulae: true,
  bypasses: false,
  special: true,
  create_systems: true,
  lane_bridges: false,
  waylines: false,
  added_systems: false,
  bodies: false,
  deposits: false,
  map_colors: false,
  lgate: false,
  symmetry: true,
};

/** The file session, as a capability read sees it. */
export interface CapabilitySource {
  capabilities: Capabilities | null;
}

/** What the app assumes before a document reports: a save's set, with symmetry left as the user set it. */
const NO_DOCUMENT: Capabilities = { ...SAVE_CAPABILITIES, symmetry: true };

/** What the open document supports, as the session reports it; `NO_DOCUMENT` until it reports any. */
export function documentCapabilities(session: CapabilitySource): Capabilities {
  return session.capabilities ?? NO_DOCUMENT;
}

/** Whether a part of the app that needs `requires` is worth showing for `capabilities`. */
export function supports(
  capabilities: Capabilities,
  requires: keyof Capabilities | undefined,
): boolean {
  return requires === undefined || capabilities[requires];
}
