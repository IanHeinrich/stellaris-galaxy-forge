import { useDeletion, type DeletionTarget } from "./useDeletion";

/** The page's button that deletes `target` (its whole ring world where it belongs to one), disabled with the core's reason while it refuses. */
export function RemovalAction({ target }: { target: DeletionTarget }) {
  const { label, refusal, run } = useDeletion(target);
  return (
    <div className="pl-remove">
      <button
        type="button"
        className="pl-remove-button"
        disabled={refusal !== null}
        title={refusal ?? undefined}
        onClick={() => void run()}
      >
        {label}
      </button>
      {refusal && <span className="muted">{refusal}</span>}
    </div>
  );
}
