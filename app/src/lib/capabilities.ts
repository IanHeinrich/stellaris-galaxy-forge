import type { Capabilities } from "../generated/Capabilities";
import { SAVE_CAPABILITIES, SCENARIO_CAPABILITIES } from "../generated/constants";

export { SAVE_CAPABILITIES, SCENARIO_CAPABILITIES };

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
