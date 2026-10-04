import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../api/__mocks__/dialog"));
// The star icons and deposit art come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import { bindStores } from "../../../store/bindStores";
import { useDetailsStore } from "../../../store/detailsStore";
import { depositTypeView, name, planetPage, resourceAmount } from "../../../store/fixture";
import { useGameDataStore } from "../../../store/gameDataStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { land, open, resetStores, SYSTEM } from "../inspectorFixture";
import { READING_STARS } from "../system/StarClassLine";
import { STARS_NEED_GAME_DATA } from "../../../lib/details/starClass";
import {
  GENERIC_HEAD,
  STAR,
  armStarClasses,
  stars,
  landPage,
  answerPage,
  render,
  PICKER,
} from "./bodyPageFixture";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

describe("a save star body's page", () => {
  const armStar = () =>
    landPage(
      planetPage({
        id: STAR,
        name: name("Alpha"),
        name_key: "Alpha",
        class: "pc_a_star",
        size: 30,
        deposits: [{ id: 1024, kind: "d_energy_2", swap_type: null }],
      }),
    );

  it("opens with its star type and size to edit, then its deposits", async () => {
    armStarClasses();
    await open("save");
    await land(stars());
    await armStar();
    usePlanetDataStore.setState({
      depositTypes: new Map([
        [
          "d_energy_2",
          depositTypeView("d_energy_2", {
            name: "+2",
            orbital: true,
            yields: [resourceAmount("energy", 2, "Energy Credits")],
          }),
        ],
      ]),
    });

    const html = render(STAR);
    expect(html).toContain('<span class="name">Alpha</span>');
    expect(html).toContain("#101");
    expect(html).toContain('<span class="edit-label">Star type</span>');
    expect(html).toContain('aria-label="Star type: Class A Star"');
    expect(html.match(PICKER)?.[0]).not.toContain("disabled");
    expect(html).toContain('<span class="edit-label">Size</span>');
    expect(html).toMatch(/<input type="number"[^>]*aria-label="Size"[^>]*value="30"/);
    expect(html.indexOf("Star type")).toBeLessThan(html.indexOf("Deposits · 1"));
    expect(html.indexOf("Deposits · 1")).toBeLessThan(html.indexOf("About"));
    expect(html).toContain("Energy Credits");
    expect(html).toContain("+ Add anomaly…");
    expect(html).toContain('title="Open the system&#x27;s page"');
    expect(html).toContain("editable · plain text is information");
    expect(html).not.toContain("Dig site");
  });

  it("waits, disabled, while an edit has left the system's details stale", async () => {
    armStarClasses();
    await open("save");
    await land(stars());
    await armStar();

    useDetailsStore.getState().invalidate([SYSTEM]);
    const html = render(STAR);
    expect(html.match(PICKER)?.[0]).toContain("disabled");
    expect(html).toContain(READING_STARS.replace("'", "&#x27;"));
  });

  it("waits for its system's details before showing the star", async () => {
    armStarClasses();
    await open("save");
    await answerPage(planetPage({ id: STAR, class: "pc_a_star", size: 30 }));

    const html = render(STAR);
    expect(html).toContain("Reading the system…");
    expect(html).not.toContain("Star type");
    expect(html).not.toContain("Deposits");
  });

  it("says why the star type is disabled without game data", async () => {
    armStarClasses();
    await open("save");
    useGameDataStore.setState({ status: "idle" });
    await land(stars());
    await armStar();

    const html = render(STAR);
    expect(html.match(PICKER)?.[0]).toContain("disabled");
    expect(html).toContain(STARS_NEED_GAME_DATA);
  });

  it("keeps the generic view on the Data tab", async () => {
    armStarClasses();
    await open("save");
    await land(stars());
    await armStar();

    const html = render(STAR, "data");
    expect(html).toContain(GENERIC_HEAD);
    expect(html).not.toContain("Star type");
    expect(html).not.toContain("Deposits");
  });
});
