import { PAINT_NOTICE_WHY } from "../../lib/paintCopy";
import { useFileSessionStore, usePaintLayer } from "../../store/fileSessionStore";
import { usePaintModStore } from "../../store/paintModStore";
import "./chrome.css";
import { PaintModStatus } from "./PaintModStatus";

/** One row under the top bar for a scenario outside the mod, until the user says it is not for them. */
export function PaintNotice() {
  const ready = useFileSessionStore((s) => s.status === "ready");
  const kind = useFileSessionStore((s) => s.kind);
  const saveIntoPaintMod = usePaintModStore((s) => s.saveIntoPaintMod);
  const paint = usePaintLayer();
  const dismissed = usePaintModStore((s) => s.noticeDismissed);
  const dismissNotice = usePaintModStore((s) => s.dismissNotice);
  const dir = usePaintModStore((s) => s.paintMod?.scenarios_dir ?? null);
  if (!ready || kind !== "scenario" || paint || dismissed) return null;

  return (
    <div className="paint-notice" role="status">
      <span>{PAINT_NOTICE_WHY}</span>
      <PaintModStatus />
      <span className="spacer" />
      <button type="button" disabled={dir === null} onClick={() => void saveIntoPaintMod()}>
        Save into the Paint a Galaxy mod…
      </button>
      <button type="button" className="link" onClick={dismissNotice}>
        Not for me
      </button>
    </div>
  );
}
