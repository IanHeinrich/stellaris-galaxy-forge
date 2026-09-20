import { PAINT_ORIGIN, PAINT_READY, isPaintReadyMessage, parsePaintMessage } from "../../lib/paint";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useLayoutStore } from "../../store/layoutStore";

/** What the window hears from the site in `frame`; anything from elsewhere is ignored. */
export function receivePaintMessage(event: MessageEvent, frame: HTMLIFrameElement | null): void {
  const site = frame?.contentWindow ?? null;
  if (site === null || event.origin !== PAINT_ORIGIN || event.source !== site) return;
  if (isPaintReadyMessage(event.data)) {
    site.postMessage(PAINT_READY, PAINT_ORIGIN);
    return;
  }
  const galaxy = parsePaintMessage(event.data);
  if (galaxy === null) return;
  void useFileSessionStore
    .getState()
    .openScenarioText(galaxy.name, galaxy.txt)
    .then((opened) => {
      if (opened) useLayoutStore.getState().hidePaintPanel();
    });
}
