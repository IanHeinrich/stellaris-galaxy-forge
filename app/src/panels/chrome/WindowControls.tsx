import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import "./chrome.css";

/** macOS keeps its own traffic lights over the bar, so the bar draws no controls there. */
const MAC = navigator.userAgent.includes("Mac");

function Glyph({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 10 10"
      width="10"
      height="10"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    >
      <path d={d} />
    </svg>
  );
}

const MINIMISE = "M0 5.5h10";
const MAXIMISE = "M0.5 0.5h9v9h-9z";
const RESTORE = "M2.5 2.5h7v7h-7zM2.5 2.5v-2h7v7h-2";
const CLOSE = "M0 0l10 10M10 0l-10 10";

/** The room the traffic lights take at the bar's left end on macOS; nothing elsewhere. */
export function TrafficLightInset() {
  return MAC ? <span className="traffic-light-inset" data-tauri-drag-region /> : null;
}

/** Minimise, maximise or restore, and close, at the bar's right end in place of the window frame's. */
export function WindowControls() {
  const [maximised, setMaximised] = useState(false);

  useEffect(() => {
    if (MAC) return;
    const win = getCurrentWindow();
    const sync = () => void win.isMaximized().then(setMaximised);
    sync();
    const unlisten = win.onResized(sync);
    return () => void unlisten.then((f) => f());
  }, []);

  if (MAC) return null;
  const win = () => getCurrentWindow();
  return (
    <div className="window-controls">
      <button
        type="button"
        aria-label="Minimise"
        title="Minimise"
        onClick={() => void win().minimize()}
      >
        <Glyph d={MINIMISE} />
      </button>
      <button
        type="button"
        aria-label={maximised ? "Restore" : "Maximise"}
        title={maximised ? "Restore" : "Maximise"}
        onClick={() => void win().toggleMaximize()}
      >
        <Glyph d={maximised ? RESTORE : MAXIMISE} />
      </button>
      <button
        type="button"
        className="close"
        aria-label="Close"
        title="Close"
        onClick={() => void win().close()}
      >
        <Glyph d={CLOSE} />
      </button>
    </div>
  );
}
