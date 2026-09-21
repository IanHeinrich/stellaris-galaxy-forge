import { useEditorStore } from "../../../store/editorStore";
import type { ContextTarget } from "../../../store/mapChromeStore";
import { confirmRemoveNebula, focusNebulaRadius, nebulaLabel } from "../../inspector/nebula";
import { MenuFrame, type Frame } from "./MenuFrame";
import { MenuItem } from "./MenuItem";

/** The menu on a nebula: its radius and its removal. */
export function NebulaMenu({
  target,
  frame,
}: {
  target: Extract<ContextTarget, { kind: "nebula" }>;
  frame: Frame;
}) {
  const selectNebula = useEditorStore((s) => s.selectNebula);
  const name = nebulaLabel(target.index);
  return (
    <MenuFrame {...frame} label={name}>
      <div className="context-menu-header">{name}</div>
      <MenuItem
        run={() => {
          selectNebula(target.index);
          focusNebulaRadius();
        }}
      >
        Set radius…
      </MenuItem>
      <MenuItem className="context-menu-separated" run={() => confirmRemoveNebula(target.index)}>
        Delete nebula
      </MenuItem>
    </MenuFrame>
  );
}
