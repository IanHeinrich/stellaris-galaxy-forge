import type { FormEvent, ReactNode } from "react";
import { Dialog, DialogFrame } from "../Dialog";
import "./overlays.css";

/**
 * The frame of a dialog that adds something where the system view's menu was opened: its title,
 * the Where row that reads the spot, what the dialog shows under it, and Cancel and the add, which
 * Enter in the form presses too.
 */
export function PlaceDialog({
  className,
  title,
  where,
  addLabel,
  addable,
  onCancel,
  onConfirm,
  children,
}: {
  /** Its own class beside the frame's, for its width. */
  className?: string;
  title: string;
  where: string;
  addLabel: string;
  addable: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (addable) onConfirm();
  };
  return (
    <Dialog
      className={
        className
          ? `dialog megastructure-add-dialog ${className}`
          : "dialog megastructure-add-dialog"
      }
      label={title}
      onClose={onCancel}
      onDismiss={onCancel}
    >
      <DialogFrame
        title={title}
        bodyClassName="megastructure-add-body"
        onSubmit={submit}
        actions={
          <>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!addable}>
              {addLabel}
            </button>
          </>
        }
      >
        <div className="field">
          <span>Where</span>
          <output>{where}</output>
        </div>
        {children}
      </DialogFrame>
    </Dialog>
  );
}
