import type { ReactNode } from "react";
import {
  openInEditor,
  useOpenLabel,
  useOpenTitle,
  type OpenTarget,
} from "../store/scriptEditorStore";

/**
 * The button that opens a script file in the modder's editor at `target`'s line, named for the
 * editor, with the file in its tooltip. With `children`, they show in its place and the name moves
 * to the tooltip.
 */
export function OpenButton({
  target,
  className,
  children,
}: {
  target: OpenTarget;
  className?: string;
  children?: ReactNode;
}) {
  const label = useOpenLabel();
  const atTop = useOpenTitle(target.file);
  return (
    <button
      type="button"
      className={className === undefined ? "link" : `link ${className}`}
      title={atTop ?? (children === undefined ? target.file : label)}
      onClick={() => void openInEditor(target)}
    >
      {children ?? label}
    </button>
  );
}
