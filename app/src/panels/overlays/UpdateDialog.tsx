import type { UpdateProgress } from "../../generated/UpdateProgress";
import type { UpdateView } from "../../generated/UpdateView";
import { parseReleaseNotes, type NoteSpan } from "../../lib/releaseNotes";
import { useUpdateStore, type UpdateStatus } from "../../store/updateStore";
import { formatSize, formatWhen } from "../../lib/text";
import { Dialog } from "../Dialog";
import "./loading.css";
import "./overlays.css";

export interface UpdateBodyProps {
  status: UpdateStatus;
  version: string | null;
  update: UpdateView | null;
  progress: UpdateProgress | null;
  error: string | null;
  onInstall(): void;
  onReleases(): void;
  onSkip(): void;
  onClose(): void;
}

/** The manifest's date as the open screen writes one; the raw string when it will not parse. */
function published(date: string): string {
  const at = Date.parse(date);
  return Number.isNaN(at) ? date : formatWhen(at / 1000);
}

/** How far the download has got, in the sizes the open screen uses for files. */
function downloadLabel(progress: UpdateProgress | null): string {
  if (progress === null) return "Starting the download…";
  if (progress.done) return "Downloaded · starting the installer";
  const got = formatSize(progress.downloaded);
  if (progress.total === null) return `Downloading… ${got}`;
  return `Downloading… ${got} of ${formatSize(progress.total)}`;
}

function Spans({ spans }: { spans: NoteSpan[] }) {
  return spans.map((span, i) =>
    span.kind === "code" ? (
      <code key={i}>{span.text}</code>
    ) : span.kind === "strong" ? (
      <strong key={i}>{span.text}</strong>
    ) : (
      span.text
    ),
  );
}

function ReleaseNotes({ notes }: { notes: string }) {
  return (
    <div className="update-notes">
      {parseReleaseNotes(notes).map((block, i) =>
        block.kind === "heading" ? (
          <h2 key={i}>
            <Spans spans={block.spans} />
          </h2>
        ) : block.kind === "list" ? (
          <ul key={i}>
            {block.items.map((item, j) => (
              <li key={j}>
                <Spans spans={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            <Spans spans={block.spans} />
          </p>
        ),
      )}
    </div>
  );
}

function DownloadState({ progress }: { progress: UpdateProgress | null }) {
  const total = progress?.total ?? null;
  const fraction = total === null || total === 0 ? null : (progress?.downloaded ?? 0) / total;
  return (
    <div className="update-download">
      {fraction === null ? (
        <div className="progress-bar indeterminate" role="progressbar" aria-label="Downloading">
          <div className="progress-fill" />
        </div>
      ) : (
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
      )}
      <div className="muted">{downloadLabel(progress)}</div>
      <div className="muted">
        The app closes while the installer runs, and opens again after it.
      </div>
    </div>
  );
}

/** What the dialog says, with nothing of its own to remember, so a test can render it with props. */
export function UpdateBody({
  status,
  version,
  update,
  progress,
  error,
  onInstall,
  onReleases,
  onSkip,
  onClose,
}: UpdateBodyProps) {
  if (status === "failed") {
    return (
      <>
        <h1>Update failed</h1>
        <p className="warn">{error ?? "The update could not be checked for."}</p>
        <div className="update-actions">
          <button type="button" onClick={onReleases}>
            Open releases page
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </>
    );
  }

  if (update === null) {
    return (
      <>
        <h1>{status === "current" ? "Up to date" : "Checking for updates"}</h1>
        {status === "current" && <p>Stellaris Galaxy Forge {version} is up to date.</p>}
        <div className="update-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </>
    );
  }

  const installing = status === "installing";
  return (
    <>
      <h1>Version {update.version} is available</h1>
      <p className="muted">
        You are running {version ?? "an unknown version"}
        {update.date !== null && ` · published ${published(update.date)}`}
      </p>
      {update.notes !== "" && <ReleaseNotes notes={update.notes} />}
      {update.install === "manual" && (
        <p>This copy is replaced by hand: download the new version from the releases page.</p>
      )}
      {installing && <DownloadState progress={progress} />}
      {error !== null && <p className="warn">{error}</p>}
      <div className="update-actions">
        {update.install === "app" && (
          <button type="button" disabled={installing} onClick={onInstall}>
            Install and restart
          </button>
        )}
        <button type="button" onClick={onReleases}>
          Open releases page
        </button>
        <button type="button" onClick={onSkip}>
          Skip this version
        </button>
        <button type="button" onClick={onClose}>
          Later
        </button>
      </div>
    </>
  );
}

/** What a check found, and what can be done about it. */
export function UpdateDialog() {
  const status = useUpdateStore((s) => s.status);
  const version = useUpdateStore((s) => s.version);
  const update = useUpdateStore((s) => s.update);
  const progress = useUpdateStore((s) => s.progress);
  const error = useUpdateStore((s) => s.error);
  const install = useUpdateStore((s) => s.install);
  const openReleases = useUpdateStore((s) => s.openReleases);
  const skip = useUpdateStore((s) => s.skip);
  const dismissDialog = useUpdateStore((s) => s.dismissDialog);

  return (
    <Dialog
      className="update-dialog"
      label="Update"
      onClose={dismissDialog}
      onDismiss={dismissDialog}
    >
      <UpdateBody
        status={status}
        version={version}
        update={update}
        progress={progress}
        error={error}
        onInstall={() => void install()}
        onReleases={() => void openReleases()}
        onSkip={skip}
        onClose={dismissDialog}
      />
    </Dialog>
  );
}
