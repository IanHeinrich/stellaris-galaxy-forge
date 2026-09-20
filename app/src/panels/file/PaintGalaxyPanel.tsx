import { useEffect, useRef } from "react";
import * as ipc from "../../api/ipc";
import { PAINT_URL, paintEmbedUrl } from "../../lib/paint";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useLayoutStore } from "../../store/layoutStore";
import { Dialog } from "../overlays/Dialog";
import "./paint.css";
import { receivePaintMessage } from "./paintMessage";

const HINT =
  "When you click Send to Stellaris Galaxy Forge in Paint a Galaxy the galaxy opens here as an " +
  "unsaved scenario.";

/** Paint a Galaxy over the map: a galaxy it sends opens here as an unsaved scenario. */
export function PaintGalaxyPanel() {
  const hide = useLayoutStore((s) => s.hidePaintPanel);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => receivePaintMessage(event, frame.current);
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const openSite = () => {
    void ipc
      .openUrl(PAINT_URL)
      .catch((e) => useFileSessionStore.getState().setError(ipc.errorMessage(e)));
  };

  return (
    <Dialog
      className="paint"
      scrim="paint-scrim"
      label="Paint a Galaxy"
      onClose={hide}
      onDismiss={hide}
    >
      <div className="paint-head">
        <h1>Paint a Galaxy by Oatmeal Problem</h1>
        <button type="button" className="link" onClick={openSite}>
          Open in browser ↗
        </button>
        <button type="button" className="link" title="Close" onClick={hide}>
          ✕
        </button>
      </div>
      <div className="muted paint-hint">{HINT}</div>
      <iframe
        ref={frame}
        className="paint-frame"
        src={paintEmbedUrl()}
        title="Paint a Galaxy"
        tabIndex={0}
        referrerPolicy="strict-origin-when-cross-origin"
        allow="clipboard-write"
      />
    </Dialog>
  );
}
