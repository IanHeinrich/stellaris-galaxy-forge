import { documentCapabilities, supports } from "../../../lib/capabilities";
import { useFileSessionStore } from "../../../store/fileSessionStore";

/** Whether the open document lets the inspector name a system and say what it is. */
export function useEditableSystem(): boolean {
  return supports(useFileSessionStore(documentCapabilities), "create_systems");
}
