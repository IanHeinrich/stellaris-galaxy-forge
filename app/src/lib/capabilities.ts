import type { Capabilities } from "../generated/Capabilities";

/** What a `.sav` supports: everything. */
export const ALL_CAPABILITIES: Capabilities = {
  empires: true,
  details: true,
  lane_lengths: true,
  nebulae: true,
  bypasses: true,
  special: true,
  create_systems: false,
  lane_bridges: true,
  waylines: true,
};

/** The file session, as a capability read sees it. */
export interface CapabilitySource {
  capabilities: Capabilities | null;
}

/** What the open document supports, as the session reports it; everything until it reports any. */
export function documentCapabilities(session: CapabilitySource): Capabilities {
  return session.capabilities ?? ALL_CAPABILITIES;
}

/** Whether a part of the app that needs `requires` is worth showing for `capabilities`. */
export function supports(
  capabilities: Capabilities,
  requires: keyof Capabilities | undefined,
): boolean {
  return requires === undefined || capabilities[requires];
}
