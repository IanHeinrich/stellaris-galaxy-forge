import { Container } from "pixi.js";
import type { Names } from "../../../lib/names";
import type { Camera } from "../../Camera";
import type { Textures } from "../../layers/details/cell";
import { NO_TEXTURES } from "../../layers/details/cell";
import type { Tip } from "../../layers/details/Hover";
import type { ResourceReach } from "../../layers/details/resources";
import { landedModel } from "../geometry";
import { plateUnder, type SceneTarget } from "../picking";
import type { SceneStructure } from "../structures";
import { LabelRow } from "./labelRow";
import {
  drawPlate,
  drawResources,
  nameplate,
  PLAIN_RESOURCE_STYLES,
  PLANET_STYLE,
  RESOURCE_GAP_PX,
  type Plate,
} from "./plate";
import { STRUCTURE_ICON_PX } from "./StructuresLayer";

/**
 * A megastructure's or a starbase's name on a plate and what it produces under it, either of
 * them alone, laid out once the width of the label it goes in is known.
 */
export interface StructureBlock {
  structure: SceneStructure;
  plate: Plate | null;
  /** What it produces; null where it produces nothing, or none is shown. */
  resources: LabelRow | null;
  w: number;
  h: number;
  /** How far down its label the block stands, in unscaled pixels; set by `layout`. */
  top: number;
  /** Stands the block with its top at `top`, centred in a label `width` wide. */
  layout(width: number, top: number): void;
}

/** A structure's shown plate and rows: its top-left in world units and its size in screen pixels. */
export interface StructurePlatePick {
  target: { kind: SceneStructure["kind"]; id: number };
  x: number;
  y: number;
  w: number;
  h: number;
  /** Screen pixels per unscaled pixel of the label it is drawn in. */
  scale: number;
  /** How far down that label it stands, in unscaled pixels. */
  top: number;
  block: StructureBlock;
}

/** What a structure's resource tooltip adds: the type's figure is not the empire's. */
export const BASE_OUTPUT_LINE = "Base output, before empire modifiers";

/** A structure that stands on no body: its block alone, slotted with the bodies' plates. */
export interface StructureLabel {
  block: StructureBlock;
  holder: Container;
}

/** Where a lone structure's label takes part in the slotting: below every wormhole's. */
const STRUCTURE_SLOTS = -1_000_000;

export function structureSlot(index: number): number {
  return STRUCTURE_SLOTS - index;
}

/** Whether `a` and `b` show the same structure plates and rows, wherever each stands. */
export function platedAlike(a: readonly SceneStructure[], b: readonly SceneStructure[]): boolean {
  return (
    a.length === b.length &&
    a.every((s, i) => s.kind === b[i].kind && s.id === b[i].id && s.plate === b[i].plate)
  );
}

/**
 * How far below its point a structure's sprite reaches on screen, or its icon's half where the
 * model has not landed: its plate goes under that.
 */
export function structureReach(s: SceneStructure, cam: Camera): number {
  const model = landedModel(s.modelKey, s.scale);
  return model ? model.below * cam.scale : STRUCTURE_ICON_PX / 2;
}

/**
 * A structure's name on a body's snug plate when `named`, and under it what it produces when
 * `details`; null when it shows neither.
 */
export function structureBlock(
  structure: SceneStructure,
  named: boolean,
  details: boolean,
  names: Names,
  holder: Container,
): StructureBlock | null {
  const rows = details ? structure.resources : [];
  if ((!named || structure.name === "") && rows.length === 0) return null;
  const own =
    named && structure.name !== "" ? nameplate(structure.name, PLANET_STYLE, false, null) : null;
  if (own) holder.addChild(own.plate.g, own.name);
  let resources: LabelRow | null = null;
  let reach: ResourceReach = { half: 0, height: 0 };
  if (rows.length > 0) {
    resources = new LabelRow("resources");
    reach = drawResources(resources.row, names, NO_TEXTURES, rows, PLAIN_RESOURCE_STYLES);
    holder.addChild(resources.root);
  }
  const plateH = own ? own.plate.h : 0;
  const rowY = own ? plateH + RESOURCE_GAP_PX : 0;
  return {
    structure,
    plate: own?.plate ?? null,
    resources,
    w: Math.max(own ? own.plate.w : 0, 2 * reach.half),
    h: resources ? rowY + reach.height : plateH,
    top: 0,
    layout(width, top) {
      this.top = top;
      if (own) {
        own.plate.x = (width - own.plate.w) / 2;
        own.plate.g.position.set(0, top);
        own.name.position.set(width / 2, top + own.nameY);
      }
      resources?.root.position.set(width / 2, top + rowY);
    },
  };
}

/** A lone structure's label: its block in a holder of its own; null when it shows nothing. */
export function makeStructureLabel(
  structure: SceneStructure,
  named: boolean,
  details: boolean,
  names: Names,
): StructureLabel | null {
  const holder = new Container();
  const block = structureBlock(structure, named, details, names, holder);
  if (!block) {
    holder.destroy({ children: true });
    return null;
  }
  block.layout(block.w, 0);
  return { block, holder };
}

/** Points each lone structure's label at its structure in `structures`; whether any moved. */
export function restand(
  labels: readonly StructureLabel[],
  structures: readonly SceneStructure[],
): boolean {
  const byKey = new Map(structures.map((s) => [`${s.kind}:${s.id}`, s]));
  let moved = false;
  for (const { block } of labels) {
    const now = byKey.get(`${block.structure.kind}:${block.structure.id}`);
    if (!now || now === block.structure) continue;
    block.structure = now;
    moved = true;
  }
  return moved;
}

/** Draws `block`'s resource row with the icons in `tex`. */
export function dressBlock({ structure, resources }: StructureBlock, names: Names, tex: Textures) {
  if (!resources) return;
  drawResources(resources.row, names, tex, structure.resources, PLAIN_RESOURCE_STYLES);
}

/** Each of `blocks`' plates, drawn hovered while `hover` is on its structure. */
export function markBlocks(blocks: readonly StructureBlock[], hover: SceneTarget | null): void {
  for (const { structure, plate } of blocks) {
    if (!plate) continue;
    const hovered =
      hover !== null && hover.kind === structure.kind && "id" in hover && hover.id === structure.id;
    drawPlate(plate, hovered ? "hovered" : "rest");
  }
}

/**
 * Where `block` is shown, with its label's top-left at the screen point (`x`, `y`), `w` wide and
 * `scale` screen pixels per unscaled pixel; null for a stand-in, which is not picked.
 */
export function structurePick(
  block: StructureBlock,
  cam: Camera,
  x: number,
  y: number,
  w: number,
  scale: number,
): StructurePlatePick | null {
  if (block.structure.chance.random) return null;
  const at = cam.screenToWorld(x, y + block.top * scale);
  const { kind, id } = block.structure;
  return {
    target: { kind, id },
    x: at.x,
    y: at.y,
    w,
    h: block.h * scale,
    scale,
    top: block.top,
    block,
  };
}

/**
 * The tooltip of the resource under the screen point on the shown plate of `target` among
 * `picks`, saying the figure is the type's base output; null for none.
 */
export function structureTip(
  picks: readonly StructurePlatePick[],
  target: { kind: string; id: number },
  cam: Camera,
  sx: number,
  sy: number,
): Tip | null {
  const pick = picks.find((p) => p.target.kind === target.kind && p.target.id === target.id);
  if (!pick?.block.resources || plateUnder([pick], cam, { x: sx, y: sy }) === null) return null;
  const top = cam.worldToScreen(pick.x, pick.y);
  const x = (sx - top.x) / pick.scale;
  const y = pick.top + (sy - top.y) / pick.scale;
  const tip = pick.block.resources.tipAt(x, y);
  return tip ? { ...tip, lines: [...tip.lines, BASE_OUTPUT_LINE] } : null;
}
