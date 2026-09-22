import type { LaneRef, SelectionMode } from "../../store/editorStore";
import type { BrushTool } from "../../lib/brush/brushStroke";
import type { ContextTarget } from "../../store/mapChromeStore";
import type { FeZonePick, NebulaPick } from "../picking";
import type { MapEdge } from "../picking/edges";
import type { Zone } from "../picking/zones";

/** Pointer travel before a press becomes a drag rather than a click. */
export const DRAG_THRESHOLD_PX = 4;

export type InputKind = "down" | "move" | "up" | "cancel";

/** Where a lane drag starts: a star's port (or the group it is selected with), or a zone's port. */
export type LaneSource = { kind: "systems"; ids: number[] } | { kind: "feZone"; anchor: number };

/**
 * What a lane drag would snap to: a system, or a zone's ring; `valid` is false when nothing
 * dragged could be joined to it, being already linked to it or its own anchor.
 */
export type LaneTarget =
  | { kind: "system"; id: number; valid: boolean }
  | { kind: "feZone"; anchor: number; valid: boolean };

/** One pointer event resolved against the map: screen and world position plus the pick. */
export interface MapInput {
  kind: InputKind;
  sx: number;
  sy: number;
  wx: number;
  wy: number;
  /** 0 left, 2 right; -1 on a move. */
  button: number;
  shift: boolean;
  /** Ctrl, or Cmd on a Mac. */
  ctrl: boolean;
  alt: boolean;
  /** The store's selection, so a drag from a selected star can act on the whole group. */
  selection: number[];
  system: number | null;
  /** Where on `system`, or on `feZone`'s ring, the pointer is; null when neither is under it. */
  zone: Zone | null;
  /** The nearest lane or zone link within tolerance, looked up only when no system is under the pointer. */
  edge: MapEdge | null;
  /** The pointer is on the hovered edge's midpoint "×". */
  midpointHit: boolean;
  /** What a lane drag from the pressed port would snap to; null when nothing is pressed. */
  snap: LaneTarget | null;
  /** A fallen empire zone's ring under the pointer, looked up only when no system and no edge is. */
  feZone: FeZonePick | null;
  /** The nebula part under the pointer, looked up only when no system, edge or ring is. */
  nebula: NebulaPick | null;
}

/** What the control model asks of the map. Edits become ops; previews stay on the map. */
export interface MapIntent {
  select(id: number): void;
  toggleSelect(id: number): void;
  selectLane(lane: LaneRef): void;
  clearSelection(): void;
  /** The marquee's corners in screen pixels, in press order. */
  previewMarquee(sx0: number, sy0: number, sx1: number, sy1: number): void;
  /** Drops the marquee rectangle, whether or not it selected anything. */
  endMarquee(): void;
  /** Selects every system inside the world rectangle, `x0 <= x1` and `y0 <= y1`. */
  selectInRect(wx0: number, wy0: number, wx1: number, wy1: number, mode: SelectionMode): void;
  previewMove(id: number, x: number, y: number): void;
  commitMove(id: number, x: number, y: number): void;
  /** Rigid move of `ids` by a world offset from the press point. */
  previewMoveGroup(ids: number[], dx: number, dy: number): void;
  commitMoveGroup(ids: number[], dx: number, dy: number): void;
  cancelMove(): void;
  /** Rubber lines from `from` (every system of a group) to the same point or target. */
  previewLane(from: LaneSource, x: number, y: number, target: LaneTarget | null): void;
  /** Drops the rubber line, whether or not the lane was connected. */
  endLane(): void;
  /** Adds the lanes, or the zone links, from `from` to `target` that are not there yet. */
  connect(from: LaneSource, target: LaneTarget): void;
  /** Removes the lane, or unlinks the system from the zone. */
  cut(edge: MapEdge): void;
  selectNebula(index: number): void;
  /** The nebula's centre follows the pointer; the controller keeps the grab offset. */
  previewNebula(index: number, x: number, y: number): void;
  commitNebula(index: number, x: number, y: number): void;
  /** The pointer's world point, which the controller reads as a radius about the fixed centre. */
  previewNebulaRadius(index: number, x: number, y: number): void;
  commitNebulaRadius(index: number, x: number, y: number): void;
  /** Drops the ghost ring, whether or not the drag changed anything. */
  endNebula(): void;
  /** A click on a zone's ring selects the system that anchors it. */
  selectFeZone(anchor: number): void;
  /** The ring follows the pointer, snapped to the mod's grid around the same anchor. */
  previewFeZone(anchor: number, x: number, y: number): void;
  commitFeZone(anchor: number, x: number, y: number): void;
  /** Drops the previewed ring, whether or not the drag changed anything. */
  endFeZone(): void;
  contextMenu(target: ContextTarget, sx: number, sy: number): void;
  /** The brush circle follows the pointer, drawn for the tool a press there would use. */
  hoverBrush(tool: BrushTool, x: number, y: number): void;
  /** A stroke of `tool` starts at the pointer. */
  beginStroke(tool: BrushTool, x: number, y: number): void;
  /** The stroke reaches on to the pointer. */
  extendStroke(x: number, y: number): void;
  /** Sends the stroke as one edit. */
  commitStroke(): void;
  /** Drops the stroke in progress and sends nothing. */
  cancelStroke(): void;
  /** Hides the brush circle. */
  endBrush(): void;
}

/**
 * A control model turns inputs into intents. Returning "pan" from a move asks the controller
 * to pan the camera by the pointer's travel.
 */
export interface MapModel {
  handle(input: MapInput, intent: MapIntent): "consumed" | "pan";
  cursor(): string;
  /** True while a drag is in progress. */
  busy(): boolean;
  /** Drops any half-finished action, clearing its preview through `intent`. */
  reset(intent: MapIntent): void;
}
