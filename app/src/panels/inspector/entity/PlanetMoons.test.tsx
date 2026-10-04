import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The star icons and deposit art come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import { bindStores } from "../../../store/bindStores";
import { name, planetPage } from "../../../store/fixture";
import { details, land, open, planet, resetStores } from "../inspectorFixture";
import { WORLD, armStarClasses, landPage, render } from "./bodyPageFixture";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

describe("a planet's moons", () => {
  it("lists its moons as the system list's rows, each opening its own page", async () => {
    armStarClasses();
    await open("save");
    await land(
      details({
        planets: [
          planet(WORLD, "Nekkar_VIII", { class: "pc_gas_giant" }),
          planet(745, "Nekkar_VIII_a", {
            class: "pc_barren_cold",
            moon: true,
            parent: WORLD,
            size: 8,
          }),
          planet(746, "Nekkar_VIII_b", { class: "pc_frozen", moon: true, parent: WORLD, size: 6 }),
        ],
      }),
    );
    await landPage(
      planetPage({
        id: WORLD,
        class: "pc_gas_giant",
        moons: [
          {
            id: 745,
            name: name("Nekkar_VIII_a"),
            name_key: "Nekkar_VIII_a",
            class: "pc_barren_cold",
            size: 8,
          },
          {
            id: 746,
            name: name("Nekkar_VIII_b"),
            name_key: "Nekkar_VIII_b",
            class: "pc_frozen",
            size: 6,
          },
        ],
      }),
    );

    const html = render(WORLD);
    expect(html).toContain("Moons · 2");
    const rows = html.match(/<div class="ins-prow"[^>]*role="button"/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(html).toContain("Nekkar VIII a");
    expect(html).toContain("Barren World");
    expect(html).toContain("Nekkar VIII b");
    expect(html.indexOf("About")).toBeLessThan(html.indexOf("Moons · 2"));
  });
});
