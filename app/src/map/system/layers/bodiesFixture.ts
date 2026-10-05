/** Texture fetching, contexts and part lookups the bodies layer's tests share. */
import { expect } from "vitest";
import { Container, Graphics, Mesh, Sprite, Texture } from "pixi.js";
import type { PlanetClassView } from "../../../generated/PlanetClassView";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import { clearTextures, setTextureDecoder } from "../../../lib/visual/textures";
import {
  byId,
  placedNode,
  planetClassView,
  saveBody,
  starClassView,
  systemDetails,
} from "../../../test/builders";
import { resetTextureFetch, textureFetch } from "../../../test/textures";
import { until } from "../../../test/wait";
import { systemContext } from "../context";
import { rollOf, SUN, SYSTEM } from "../fixture";
import { NO_SOURCES } from "../sources";
import type { BodiesLayer } from "./BodiesLayer";

/** Drops the last fetch's answer, so a test waits for its own. */
export function forgetFetch(): void {
  textureFetch.release = null;
}

/** Answers every lit-disc request with an error, as for a class with no surface map. */
export function noLitDiscs(): void {
  textureFetch.fails = (key) => key.startsWith("planet_disc:");
}

/** Lets the held fetch answer, once the layer has asked. */
export async function answerFetch(): Promise<void> {
  await until(() => expect(textureFetch.release).not.toBeNull());
  const release = textureFetch.release;
  forgetFetch();
  release?.();
}

/** One texture per key, so a test can tell which key a sprite shows. */
export function decodeByKey(): (key: string) => Texture {
  const decoded = new Map<string, Texture>();
  const textureFor = (key: string) => {
    let texture = decoded.get(key);
    if (!texture) decoded.set(key, (texture = new Texture()));
    return texture;
  };
  setTextureDecoder((view) => Promise.resolve(textureFor(view.key)));
  return textureFor;
}

export function resetTextures(): void {
  clearTextures();
  resetTextureFetch();
  textureFetch.mode = "held";
  setTextureDecoder(null);
}

/** A system of the one star `planetClass`, of the star class `starClass`. */
export const starContext = (planetClass: string, starClass: string) =>
  systemContext({
    ...NO_SOURCES,
    id: SYSTEM,
    systems: byId(placedNode(SYSTEM, 0, 0)),
    details: systemDetails({
      id: SYSTEM,
      planets: [{ ...saveBody(1, planetClass, [0, 0], 0, 16), star_class: starClass }],
    }),
    starClasses: new Map([[starClass, starClassView(starClass, planetClass)]]),
  });

export const scenarioContext = (planets: PlanetSummary[]) =>
  systemContext({
    ...NO_SOURCES,
    id: SYSTEM,
    systems: byId(placedNode(SYSTEM, 0, 0)),
    details: systemDetails({ id: SYSTEM, planets }),
    roll: rollOf(planets),
    planetClasses: new Map([
      ["pc_g_star", planetClassView("pc_g_star")],
      ["pc_arid", { ...planetClassView("pc_arid", false), icon_sprite: "GFX_arid" }],
      [
        "random_colonizable",
        { ...planetClassView("random_colonizable", false), icon_sprite: "GFX_random" },
      ],
    ]),
  });

/** The holder a body is drawn in, found by its drawn point. */
export const holderAt = (layer: BodiesLayer, x: number, y: number) => {
  const holder = layer.container.children.find(
    (c) => Math.abs(c.x - x) < 1e-6 && Math.abs(c.y - y) < 1e-6,
  );
  if (!(holder instanceof Container)) throw new Error(`no body at ${x}, ${y}`);
  return holder;
};
export const sprites = (holder: Container) =>
  holder.children.filter((c): c is Sprite => c instanceof Sprite);
/** The part of a body the layer labelled `label`, if it drew one. */
export const part = (holder: Container, label: string) =>
  holder.children.find((c) => c.label === label);
export const sprite = (holder: Container, label: string) => {
  const found = part(holder, label);
  if (!(found instanceof Sprite)) throw new Error(`no ${label} sprite`);
  return found;
};
export const mesh = (holder: Container, label: string) => {
  const found = part(holder, label);
  if (!(found instanceof Mesh)) throw new Error(`no ${label} mesh`);
  return found;
};
export const graphics = (holder: Container, label: string) => {
  const found = part(holder, label);
  return found instanceof Graphics ? found : undefined;
};

export const hazy = (key: string): PlanetClassView => ({
  ...planetClassView(key, false),
  atmosphere_color: "#3366cc",
  atmosphere_intensity: 1,
  atmosphere_width: 0.5,
});
export const iconed = (key: string, large: string | null = null): PlanetClassView => ({
  ...planetClassView(key, false),
  icon_sprite: `GFX_${key}`,
  icon_large_sprite: large,
});

/** A G star with `planets` about it, of the classes `classes` define. */
export const classedContext = (planets: PlanetSummary[], classes: PlanetClassView[]) =>
  systemContext({
    ...NO_SOURCES,
    id: SYSTEM,
    systems: byId(placedNode(SYSTEM, 0, 0)),
    details: systemDetails({ id: SYSTEM, planets: [SUN, ...planets] }),
    planetClasses: new Map(
      [planetClassView("pc_g_star"), ...classes].map((view) => [view.key, view]),
    ),
  });
export const EARTH_AT: [number, number] = [90, 0];
export const MARS_AT: [number, number] = [0, 130];
