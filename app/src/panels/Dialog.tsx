import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { ESCAPE } from "./keys";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

/**
 * A modal dialog: takes focus itself on open unless a control inside asked for it, so a choice
 * is never outlined before the keyboard reaches it; traps Tab inside it, restores focus to
 * whatever had it on close, and treats Escape as a close request. With `onDismiss` it sits on a
 * scrim that answers a press on the backdrop.
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
