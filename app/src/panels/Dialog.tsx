import { useEffect, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ENTER, ESCAPE } from "./keys";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

/** Submits the form under `root` by its first submit button, unless that button is disabled. */
function submitForm(root: HTMLElement): void {
  const form = root.querySelector("form");
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]') ?? null;
  if (form === null || button?.disabled === true) return;
  form.requestSubmit(button);
}

/**
 * A modal dialog: takes focus itself on open unless a control inside asked for it, so a choice
 * is never outlined before the keyboard reaches it; traps Tab inside it, restores focus to
 * whatever had it on close, and treats Escape as a close request. Enter while it holds focus
 * itself submits its form, as Enter in a field would, but not a held key's repeats, which began
 * before it opened. A dialog that opens without the player asking, such as Update, has no form,
 * so a key meant for the screen under it takes no action. With `onDismiss` it sits on a scrim
 * that answers a press on the backdrop.
 */
export function Dialog({
  className,
  scrim = "launch",
  label,
  onClose,
  onDismiss,
  children,
}: {
  className?: string;
  scrim?: string;
  label: string;
  onClose: () => void;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === ESCAPE) {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === ENTER && !e.repeat && e.target === ref.current) {
      submitForm(ref.current);
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const items = focusable(ref.current);
    if (items.length === 0) return;
    const last = items.length - 1;
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey ? at <= 0 : at === last) {
      e.preventDefault();
      items[e.shiftKey ? last : 0].focus();
    }
  };

  const dialog = (
    <div
      ref={ref}
      className={className}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
  if (onDismiss === undefined) return dialog;
  return (
    <div
      className={scrim}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      {dialog}
    </div>
  );
}

/**
 * What a dialog shows inside `Dialog`: its title, a body that scrolls, and a foot of buttons,
 * Cancel first and the primary action last. `aside` goes beside the title and `note` under the
 * buttons. With `onSubmit` the frame is a form, so Enter submits it.
 */
export function DialogFrame({
  title,
  aside,
  bodyClassName,
  actions,
  note,
  onSubmit,
  children,
}: {
  title: ReactNode;
  aside?: ReactNode;
  bodyClassName?: string;
  actions: ReactNode;
  note?: ReactNode;
  onSubmit?: (e: FormEvent) => void;
  children: ReactNode;
}) {
  const frame = (
    <>
      <div className="dialog-head">
        <h1>{title}</h1>
        {aside}
      </div>
      <div className={bodyClassName === undefined ? "dialog-body" : `dialog-body ${bodyClassName}`}>
        {children}
      </div>
      <div className="dialog-foot">
        <div className="dialog-actions">{actions}</div>
        {note}
      </div>
    </>
  );
  return onSubmit === undefined ? frame : <form onSubmit={onSubmit}>{frame}</form>;
}
