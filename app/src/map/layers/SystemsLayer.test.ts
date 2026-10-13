import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { until } from "../../test/wait";

vi.mock("../../api/gamedata", () => import("../../test/textures"));

import { Texture, type Renderer } from "pixi.js";
import {
  clearTextures,
  getTexture,
  requestTextures,
  setTextureDecoder,
} from "../../lib/visual/textures";
import { starClassView } from "../../test/builders";
import { resetTextureFetch, textureFetch } from "../../test/textures";
import { DrawnPositions } from "../drawnPositions";
import { mapContext, mapNode } from "./fixture";
import { SystemsLayer } from "./SystemsLayer";

const renderer = { generateTexture: () => Texture.EMPTY } as unknown as Renderer;
const STAR = "star_class:sc_g";

beforeEach(() => {
  textureFetch.mode = "views";
  setTextureDecoder(() => Promise.resolve(Texture.EMPTY));
});

afterEach(() => {
  setTextureDecoder(null);
  resetTextureFetch();
  clearTextures();
  vi.restoreAllMocks();
});

describe("the galaxy map's systems layer as textures land", () => {
  it("places its systems again for a star texture and for no other", async () => {
    const drawn = new DrawnPositions();
    const placed = vi.spyOn(drawn, "y");
    const layer = new SystemsLayer(renderer, drawn);
    const nodes = Array.from({ length: 5 }, (_, i) => mapNode(i, i * 10, `S${i}`));
    layer.rebuild(mapContext(nodes, { starClasses: new Map([["sc_g", starClassView("sc_g")]]) }));
    await until(() => expect(getTexture(STAR)).toBeDefined());

    placed.mockClear();
    requestTextures(["model:gateway:yaw90", "icon:megastructure"]);
    await until(() => expect(getTexture("icon:megastructure")).toBeDefined());
    expect(placed).not.toHaveBeenCalled();

    clearTextures();
    expect(placed).toHaveBeenCalled();
  });
});
