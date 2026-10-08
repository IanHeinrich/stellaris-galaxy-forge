import * as ipc from "../api/ipc";
import { guideUrl, type GuidePlace } from "../lib/guideLinks";
import { useFileSessionStore } from "../store/fileSessionStore";

/**
 * Opens the user guide in the user's browser, at `place` and its `anchor` when given, else at
 * its front page; a refusal lands on the session.
 */
export function openGuide(place?: GuidePlace, anchor?: string): void {
  void ipc
    .openUrl(place === undefined ? ipc.GUIDE_URL : guideUrl(place, anchor))
    .catch((e) => useFileSessionStore.getState().setError(ipc.errorMessage(e)));
}
