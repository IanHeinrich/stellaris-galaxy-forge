import type { ReactNode } from "react";
import { useMapChromeStore } from "../../../store/mapChromeStore";

/** One entry of a menu: closes the menu, then runs `run`, as the menu bar's items do. */
export function MenuItem({
  run,
  className,
  disabled,
  title,
  children,
}: {
  run: () => unknown;
  className?: string;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  const closeContextMenu = useMapChromeStore((s) => s.closeContextMenu);
  return (
    <button
      type="button"
      role="menuitem"
      className={className}
      disabled={disabled}
      title={title}
      onClick={() => {
        closeContextMenu();
        void run();
      }}
    >
      {children}
    </button>
  );
}
