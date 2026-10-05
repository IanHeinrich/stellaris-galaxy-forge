import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMapChromeStore, type ContextMenu as MenuAt } from "../../store/mapChromeStore";
import { useOutsidePress } from "../useOutsidePress";
import { menuItems, menuKeyDown } from "../menuKeys";
import { BeltMenu } from "./contextMenu/BeltMenu";
import { BodyMenu } from "./contextMenu/BodyMenu";
import { BodyRowMenu } from "./contextMenu/BodyRowMenu";
import { FeZoneMenu } from "./contextMenu/FeZoneMenu";
import { LaneMenu } from "./contextMenu/LaneMenu";
import type { Frame } from "./contextMenu/MenuFrame";
import { NebulaMenu } from "./contextMenu/NebulaMenu";
import { PreventedMenu } from "./contextMenu/PreventedMenu";
import { SceneSpaceMenu } from "./contextMenu/SceneSpaceMenu";
import { SpaceMenu } from "./contextMenu/SpaceMenu";
import { SystemMenu } from "./contextMenu/SystemMenu";
import "./overlays.css";

const EDGE_PX = 8;

/**
 * The gesture model's right-click menu (ADR 0003), anchored in `.map-area` pixels and moved up
 * where it would run past the bottom of the map area.
 */
export function ContextMenu() {
  const contextMenu = useMapChromeStore((s) => s.contextMenu);
  const closeContextMenu = useMapChromeStore((s) => s.closeContextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [raised, setRaised] = useState<{ menu: MenuAt; top: number } | null>(null);

  useOutsidePress(contextMenu !== null, closeContextMenu, ref);
  useEffect(() => {
    if (contextMenu) menuItems(ref.current)[0]?.focus();
  }, [contextMenu]);
  useLayoutEffect(() => {
    const el = ref.current;
    const area = el?.parentElement;
    if (!contextMenu || !el || !area) return;
    const lowest = area.clientHeight - EDGE_PX - el.offsetHeight;
    if (contextMenu.y > lowest) {
      setRaised({ menu: contextMenu, top: Math.max(EDGE_PX, lowest) });
    }
  }, [contextMenu]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    menuKeyDown(ref.current, e);
  };

  if (!contextMenu) return null;
  const { target } = contextMenu;
  const top = raised?.menu === contextMenu ? raised.top : contextMenu.y;
  const frame: Frame = { ref, onKeyDown, style: { left: contextMenu.x, top } };
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
    case "body":
      return <BodyMenu target={target} frame={frame} />;
    case "belt":
      return <BeltMenu target={target} frame={frame} />;
    case "systemSpace":
      return <SceneSpaceMenu target={target} frame={frame} />;
    case "bodyRow":
      return <BodyRowMenu target={target} frame={frame} />;
  }
}
