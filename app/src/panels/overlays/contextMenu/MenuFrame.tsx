import type { ComponentProps, ReactNode } from "react";

/** What the shell pins a menu with: its element for focus, its keyboard handling and its position. */
export type Frame = Pick<ComponentProps<"div">, "ref" | "onKeyDown" | "style">;

/** The positioned `role="menu"` box a per-kind body fills. */
export function MenuFrame({
  ref,
  onKeyDown,
  style,
  label,
  children,
}: Frame & { label: string | undefined; children: ReactNode }) {
  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={style}
    >
      {children}
    </div>
  );
}
