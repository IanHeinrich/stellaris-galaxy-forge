/** What a system view layer test reads back from PixiJS, beside everything `fixture` builds. */
import { BitmapText, Texture, type Container } from "pixi.js";
import type { SceneTextures } from "./layers/textures";

export * from "./fixture";
export { drawOps, strokes, stubTextMeasurement } from "../layers/fixture";

/** Every scene texture, blank. */
export function blankSceneTextures(): SceneTextures {
  const t = () => new Texture();
  return {
    disc: t(),
    corona: t(),
    beam: t(),
    plume: t(),
    wisps: t(),
    halo: t(),
    swirl: t(),
    shade: t(),
    gloss: t(),
    belt: {
      rock: t(),
      shard: t(),
      crystal: t(),
      container: t(),
      blob: t(),
      speck: t(),
      glint: t(),
      glow: t(),
    },
    ringBack: t(),
    ringFront: t(),
    nebula: t(),
    wormholeHaze: t(),
    wormholeSwirl: t(),
    wormholeRim: t(),
  };
}

/** The amounts a label's resource row shows, in order: its visible texts that are numbers. */
export function resourceAmounts(holder: Container): string[] {
  const row = holder.children.find((c) => c.label === "resources");
  if (!row) return [];
  const texts = (c: Container): string[] => [
    ...(c instanceof BitmapText && c.visible && /^\d/.test(c.text) ? [c.text] : []),
    ...c.children.flatMap(texts),
  ];
  return texts(row);
}

/** The texts labelled `label` on the plates shown in `container`. */
export function plateTexts(container: Container, label: string): string[] {
  return container.children
    .filter((holder) => holder.visible)
    .flatMap((holder) => holder.children)
    .flatMap((c) => (c instanceof BitmapText && c.label === label ? [c.text] : []));
}
