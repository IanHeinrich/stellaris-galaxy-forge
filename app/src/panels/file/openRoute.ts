import { isSavePath, type OpenMode } from "../../store/fileSessionStore";
/**
 * A plain activation of a save asks whether to edit it as a save or as a scenario; the
 * "as scenario" button and Shift+Enter skip the question, and a scenario file has none.
 */
export function openRoute(path: string, asScenario: boolean): OpenMode | "ask" {
  if (asScenario) return "scenario";
  return isSavePath(path) ? "ask" : "save";
}
