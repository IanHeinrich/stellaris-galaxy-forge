import type { ReactNode } from "react";
import { useMapChromeStore } from "../../../store/mapChromeStore";

/**
 * One entry of a menu: closes the menu, then runs `run`, as the menu bar's items do. A `shortcut`
 * shows on the right of its first line. A `refusal` disables the item, and shows its reason below
 * the label and as the tooltip. It is the menu's active row while it has the pointer or the
 * focus, showing the pick card `card` names.
 */
export function MenuItem({
  card,
  run,
  className,
  disabled,
  title,
  shortcut,
  refusal,
  children,
}: {
  card?: string;
  run: () => unknown;
  className?: string;
  disabled?: boolean;
  title?: string;
  shortcut?: string;
  refusal?: string | null;
  children: ReactNode;
}) {
  const closeContextMenu = useMapChromeStore((s) => s.closeContextMenu);
  const enterMenuRow = useMapChromeStore((s) => s.enterMenuRow);
  const leaveMenuRow = useMapChromeStore((s) => s.leaveMenuRow);
  const enter = (el: HTMLElement) => enterMenuRow({ el, card: card ?? null });
  const classes = [className, shortcut && "keyed", refusal && "hinted"].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      role="menuitem"
      className={classes === "" ? undefined : classes}
      disabled={disabled || Boolean(refusal)}
      title={refusal || title}
      onPointerEnter={(e) => enter(e.currentTarget)}
      onFocus={(e) => enter(e.currentTarget)}
      onPointerLeave={(e) => leaveMenuRow(e.currentTarget)}
      onBlur={(e) => leaveMenuRow(e.currentTarget)}
      onClick={() => {
        closeContextMenu();
        void run();
      }}
    >
      {children}
      {refusal && <span className="muted">{refusal}</span>}
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}

/**
 * An entry the core or the game data may refuse: disabled until `refusal` is null, which the core
 * answers after a wait, and showing the reason once it is a sentence.
 */
export function RefusableMenuItem({
  refusal,
  ...item
}: {
  refusal: string | null | undefined;
  run: () => unknown;
  className?: string;
  shortcut?: string;
  children: ReactNode;
}) {
  return <MenuItem {...item} refusal={refusal} disabled={refusal !== null} />;
}
