import { useEffect, useRef } from "react";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { FeZoneMenu } from "./contextMenu/FeZoneMenu";
import { LaneMenu } from "./contextMenu/LaneMenu";
import type { Frame } from "./contextMenu/MenuFrame";
import { NebulaMenu } from "./contextMenu/NebulaMenu";
import { SpaceMenu } from "./contextMenu/SpaceMenu";
import { SystemMenu } from "./contextMenu/SystemMenu";
import "./overlays.css";

function itemsOf(root: HTMLElement | null): HTMLElement[] {
  return [...(root?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
}

/** The gesture model's right-click menu (ADR 0003), anchored in `.map-area` pixels. */
export function ContextMenu() {
  const contextMenu = useMapChromeStore((s) => s.contextMenu);
  const closeContextMenu = useMapChromeStore((s) => s.closeContextMenu);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    itemsOf(ref.current)[0]?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeContextMenu();
    };
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [contextMenu, closeContextMenu]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = itemsOf(ref.current);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => {
      e.preventDefault();
      items[(index + items.length) % items.length].focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at <= 0 ? items.length - 1 : at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
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
  }
}
