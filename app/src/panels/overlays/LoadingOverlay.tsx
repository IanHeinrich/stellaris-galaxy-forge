import type { Progress } from "../../generated/Progress";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { Dialog } from "../Dialog";
import "./loading.css";

const PHASE: Record<string, string> = {
  read: "Reading the archive",
  project: "Building the galaxy",
  validate: "Validating",
  write: "Writing",
  done: "Finishing",
};

function phaseLabel(progress: Progress): string {
  const phase = PHASE[progress.phase] ?? progress.phase;
  return `${phase} · ${Math.round(progress.fraction * 100)}%`;
}

/**
 * The one indicator for a document being opened or reloaded, whichever entry point started it.
 * It carries no controls: an open cannot be cancelled.
 */
export function LoadingOverlay() {
  const status = useFileSessionStore((s) => s.status);
  const settling = useFileSessionStore((s) => s.settling);
  const name = useFileSessionStore((s) => s.loadingName);
  const progress = useFileSessionStore((s) => s.progress);
  if (status !== "loading" && !settling) return null;

  const title = name === null ? "Opening" : `Opening ${name}`;
  return (
    <div className="launch loading-scrim">
      <Dialog className="start-card loading-card" label={title} onClose={() => undefined}>
        <h1>{title}</h1>
        <div className="progress-label" aria-live="polite">
          {settling ? "Reading the scripts" : progress === null ? "Working…" : phaseLabel(progress)}
        </div>
        {!settling && progress !== null ? (
          <div
            className="progress-bar"
            role="progressbar"
            aria-label="Opening"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.fraction * 100)}
          >
            <div
              className="progress-fill"
              style={{ width: `${Math.round(progress.fraction * 100)}%` }}
            />
          </div>
        ) : (
          <div className="progress-bar indeterminate" role="progressbar" aria-label="Opening">
            <div className="progress-fill" />
          </div>
        )}
      </Dialog>
    </div>
  );
}
