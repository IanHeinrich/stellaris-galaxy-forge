import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/gamedata", () => import("../../../test/textures"));

import { planetClassView, saveBody } from "../../../test/builders";
import { textureFetch } from "../../../test/textures";
import { until } from "../../../test/wait";
import { SUN, blankSceneTextures, viewport } from "../drawFixture";
import { drawnDisc } from "../geometry";
import { pickBody } from "../picking";
import { BodiesLayer } from "./BodiesLayer";
import {
  answerFetch,
  classedContext,
  decodeByKey,
  holderAt,
  resetTextures,
  sprite,
} from "./bodiesFixture";

beforeEach(resetTextures);

const HABITAT = planetClassView("pc_habitat", false, null, {
  flat_art: true,
  body_model: "orbital_habitat_01_entity",
});
const SEGMENT = planetClassView("pc_ringworld_tech", false, null, {
  flat_art: true,
  ringworld: true,
  body_model: "ringworld_tech_entity_01_entity",
});
const BROKEN = planetClassView("pc_shattered", false, null, { flat_art: true });
const CLASSES = [HABITAT, SEGMENT, BROKEN];

/** A model 8 units wide and 4 tall whose origin is at its middle. */
const PLACEMENT = { width: 8, height: 4, anchor_x: 0.5, anchor_y: 0.5 };

describe("a habitat or a ring world segment drawn from its model", () => {
  it("takes its model from its class, in its owner's culture, turned to the star for a segment only", () => {
    const owned = { ...saveBody(2, HABITAT.key, [60, 0], 60, 5, SUN), culture: "avian_01" };
    const named = {
      ...saveBody(3, HABITAT.key, [0, 60], 60, 5, SUN),
      entity_name: "reptilian_01_habitat_phase_03_entity",
    };
    const segment = saveBody(4, SEGMENT.key, [0, 45], 45, 10, SUN);
    const broken = saveBody(5, BROKEN.key, [-60, 0], 60, 10, SUN);
    const ctx = classedContext([owned, named, segment, broken], CLASSES);
    const model = (id: number) => ctx.bodyById.get(id)!.look.model;
    expect(model(owned.id)).toBe("model:avian_01:orbital_habitat_01_entity");
    expect(model(named.id)).toBe("model:mammalian_01:reptilian_01_habitat_phase_03_entity");
    expect(model(segment.id)).toBe("model:mammalian_01:ringworld_tech_entity_01_entity:yaw270");
    expect(model(broken.id)).toBeNull();
  });

  it("shows its icon until the model lands, then the model at its own size, which picking and its plate follow", async () => {
    const textureFor = decodeByKey();
    textureFetch.model = (key) => (key.startsWith("model:") ? PLACEMENT : undefined);
    const habitat = saveBody(2, HABITAT.key, [60, 0], 60, 5, SUN);
    const ctx = classedContext([habitat], CLASSES);
    const body = ctx.bodyById.get(habitat.id)!;
    const layer = new BodiesLayer(blankSceneTextures());
    layer.rebuild(ctx);
    const cam = viewport(layer, 4);
    const holder = holderAt(layer, 60, 0);
    const model = sprite(holder, "model");
    expect(model.visible).toBe(false);
    expect(sprite(holder, "disc").visible).toBe(true);
    const before = drawnDisc(body.placement.disc, cam.scale, body.look);

    await answerFetch();
    await until(() => expect(model.visible).toBe(true));
    const texture = textureFor("model:mammalian_01:orbital_habitat_01_entity");
    expect(model.texture).toBe(texture);
    expect(model.scale.x * texture.width).toBeCloseTo(PLACEMENT.width);
    expect(model.scale.y * texture.height).toBeCloseTo(PLACEMENT.height);
    expect(sprite(holder, "disc").visible).toBe(false);

    const after = drawnDisc(body.placement.disc, cam.scale, body.look);
    expect(after).toBeCloseTo(PLACEMENT.width / 2);
    expect(after).not.toBeCloseTo(before);
    expect(pickBody(ctx.bodies, cam, { x: 60 + 0.9 * after, y: 0 })).toBe(habitat.id);
    layer.destroy();
  });
});
