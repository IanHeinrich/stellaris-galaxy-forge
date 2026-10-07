import type { ReactNode } from "react";
import { useMapChromeStore } from "../../../store/mapChromeStore";

/**
 * One entry of a menu: closes the menu, then runs `run`, as the menu bar's items do. A `shortcut`
 * shows on the right of its first line.
 */
export function MenuItem({
  run,
  className,
  disabled,
  title,
  shortcut,
  children,
}: {
  run: () => unknown;
  className?: string;
  disabled?: boolean;
  title?: string;
  shortcut?: string;
  children: ReactNode;
}) {
  const closeContextMenu = useMapChromeStore((s) => s.closeContextMenu);
  const classes = [className, shortcut && "keyed"].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      role="menuitem"
      className={classes === "" ? undefined : classes}
      disabled={disabled}
      title={title}
      onClick={() => {
        closeContextMenu();
        void run();
      }}
    >
      {children}
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}
