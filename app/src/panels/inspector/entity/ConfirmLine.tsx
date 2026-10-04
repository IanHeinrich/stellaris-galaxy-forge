/** What the game will take away for an edit waiting on the user, and the buttons that make it or drop it. */
export function ConfirmLine({
  className,
  warnings,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  className: string;
  warnings: readonly string[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={className} role="alert">
      {warnings.map((warning) => (
        <span key={warning}>{warning}</span>
      ))}
      <span className="pl-dep-confirm-actions">
        <button type="button" className="dp-amount" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="dp-amount" onClick={onCancel}>
          Cancel
        </button>
      </span>
    </div>
  );
}
