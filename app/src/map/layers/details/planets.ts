import type { Graphics } from "pixi.js";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import { PLANET_ICON_KEYS, PLANET_SIZE_ICON_KEY, planetTint } from "../../../lib/details/icons";
import { planetClassLabel, planetLine } from "../../../lib/details/labels";
import { PLANET_STACK } from "../../../lib/details/layout";
import type { MapTooltipLine } from "../../../store/mapChromeStore";
import type { RenderContext } from "../../RenderContext";
import { PLANET_DX, PLANET_PX, PLANET_Y, type Textures } from "./cell";
import type { Tip } from "./Hover";
import type { Row } from "./Row";

const PLANET_RIGHT = -PLANET_STACK.gap;
const MAX_PLANETS = PLANET_STACK.max;
const DOT_RADIUS = 6;

/** Drawn from the farthest planet in, so the one nearest the star lies on top. */
export function planetIcons(
  row: Row,
  ctx: RenderContext,
  tex: Textures,
  planets: PlanetSummary[],
): void {
  const tip = planetsTip(ctx, tex, planets);
  const shown = planets.slice(0, MAX_PLANETS);
  for (let i = shown.length - 1; i >= 0; i--) {
    const x = PLANET_RIGHT - PLANET_PX - i * PLANET_DX;
    const texture = tex.resolve(PLANET_ICON_KEYS);
    if (texture) row.sprite(texture, x, PLANET_Y, PLANET_PX, tip);
    else planetDot(row.planetMarks, shown[i], x, PLANET_Y);
  }
  planetOverflow(row, planets, tip);
}

export function planetDots(
  row: Row,
  ctx: RenderContext,
  tex: Textures,
  planets: PlanetSummary[],
): void {
  planets.slice(0, MAX_PLANETS).forEach((p, i) => {
    planetDot(row.planetMarks, p, PLANET_RIGHT - PLANET_PX - i * PLANET_DX, PLANET_Y);
  });
  planetOverflow(row, planets, planetsTip(ctx, tex, planets));
}

/** One tooltip line per planet: its name, class, size and owner. */
export function planetLines(
  ctx: RenderContext,
  tex: Textures,
  planets: readonly PlanetSummary[],
): MapTooltipLine[] {
  return planets.map((p) => {
    const sizeIcon = Boolean(tex.texture(PLANET_SIZE_ICON_KEY));
    const sprite = ctx.planetClasses.get(p.class)?.icon_sprite;
    const classKey = sprite ? `sprite:${sprite}` : null;
    const classIcon = classKey && tex.texture(classKey) ? classKey : null;
    const classLabel = ctx.names.get(p.class) ?? planetClassLabel(p.class);
    return planetLine(p, ctx.templateName(p), classLabel, ctx.countryName, sizeIcon, classIcon);
  });
}

function planetDot(marks: Graphics, p: PlanetSummary, x: number, y: number): void {
  marks
    .circle(x + PLANET_PX / 2, y + PLANET_PX / 2, DOT_RADIUS)
    .fill({ color: planetTint(p.class) });
}

function planetOverflow(row: Row, planets: PlanetSummary[], tip: Tip): void {
  if (planets.length === 0) return;
  if (planets.length > MAX_PLANETS) {
    const x = PLANET_RIGHT - PLANET_PX - MAX_PLANETS * PLANET_DX;
    const w = row.text(`+${planets.length - MAX_PLANETS}`, x, PLANET_Y + 5, tip);
    row.nudgeLastText(-w - 2);
  }
  row.planetTip(tip);
}

function planetsTip(ctx: RenderContext, tex: Textures, planets: PlanetSummary[]): Tip {
  return { title: "Free habitable planets", lines: planetLines(ctx, tex, planets) };
}
