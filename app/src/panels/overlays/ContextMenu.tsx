import { useEffect, useRef } from "react";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useOutsidePress } from "../useOutsidePress";
import { menuItems, menuKeyDown } from "../menuKeys";
import { FeZoneMenu } from "./contextMenu/FeZoneMenu";
import { LaneMenu } from "./contextMenu/LaneMenu";
import type { Frame } from "./contextMenu/MenuFrame";
import { NebulaMenu } from "./contextMenu/NebulaMenu";
import { PreventedMenu } from "./contextMenu/PreventedMenu";
import { SpaceMenu } from "./contextMenu/SpaceMenu";
import { SystemMenu } from "./contextMenu/SystemMenu";
import "./overlays.css";

/** The gesture model's right-click menu (ADR 0003), anchored in `.map-area` pixels. */
export function ContextMenu() {
  const contextMenu = useMapChromeStore((s) => s.contextMenu);
  const closeContextMenu = useMapChromeStore((s) => s.closeContextMenu);
  const ref = useRef<HTMLDivElement>(null);

  useOutsidePress(contextMenu !== null, closeContextMenu, ref);
  useEffect(() => {
    if (contextMenu) menuItems(ref.current)[0]?.focus();
  }, [contextMenu]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    menuKeyDown(ref.current, e);
  };

  if (!contextMenu) return null;
  const { target } = contextMenu;
  const frame: Frame = { ref, onKeyDown, style: { left: contextMenu.x, top: contextMenu.y } };
  switch (target.kind) {
    case "space":
      return <SpaceMenu target={target} frame={frame} />;
    case "system":
      return <SystemMenu target={target} frame={frame} />;
    case "nebula":
      return <NebulaMenu target={target} frame={frame} />;
    case "feZone":
      return <FeZoneMenu target={target} frame={frame} />;
    case "lane":
      return <LaneMenu target={target} frame={frame} />;
    case "prevented":
      return <PreventedMenu target={target} frame={frame} />;
  }
}
