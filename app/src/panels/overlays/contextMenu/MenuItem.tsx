import type { ReactNode } from "react";
import { useMapChromeStore } from "../../../store/mapChromeStore";

/** One entry of a menu: runs `run`, then closes the menu. */
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
        void run();
        closeContextMenu();
      }}
    >
      {children}
    </button>
  );
}
