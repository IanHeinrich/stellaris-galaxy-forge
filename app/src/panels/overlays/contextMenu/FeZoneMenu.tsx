import { linkSelectedLabel, takesCustomLinks, USE_NEAREST_LABEL } from "../../../lib/feLinks";
import { useSystemNames } from "../../../store/browserRows";
import { useEditorStore } from "../../../store/editorStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import type { ContextTarget } from "../../../store/mapChromeStore";
import { MenuFrame, type Frame } from "./MenuFrame";
import { MenuItem } from "./MenuItem";
import { useSelected, useZoneLink } from "./menuState";

/** The menu on a fallen empire zone's ring: its anchor, its links and its removal. */
export function FeZoneMenu({
  target,
  frame,
}: {
  target: Extract<ContextTarget, { kind: "feZone" }>;
  frame: Frame;
}) {
  const setFeZone = useEditorStore((s) => s.setFeZone);
  const select = useEditorStore((s) => s.select);
  const resetFeLinks = useEditorStore((s) => s.resetFeLinks);
  const systems = useGalaxyStore((s) => s.systems);
  const { selected, selectedName } = useSelected();
  const linkItem = useZoneLink();
  const [name] = useSystemNames([target.anchor]);

  const anchor = systems.get(target.anchor);
  const link = linkItem(anchor, selected);
  const custom = anchor !== undefined && takesCustomLinks(anchor);
  return (
    <MenuFrame {...frame} label={`Fallen empire zone of ${name}`}>
      <div className="context-menu-header">Fallen empire zone</div>
      <MenuItem run={() => setFeZone(target.anchor, null)}>Remove fallen empire zone</MenuItem>
      <MenuItem run={() => select(target.anchor)}>Select {name}</MenuItem>
      {link !== null && (
        <MenuItem className="context-menu-separated" run={link.run}>
          {linkSelectedLabel(link.change, selectedName)}
        </MenuItem>
      )}
      {custom && (
        <MenuItem
          className={link === null ? "context-menu-separated" : undefined}
          run={() => resetFeLinks(target.anchor)}
        >
          {USE_NEAREST_LABEL}
        </MenuItem>
      )}
    </MenuFrame>
  );
}
