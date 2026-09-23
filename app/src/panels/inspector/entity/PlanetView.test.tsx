import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../api/__mocks__/dialog"));
// The star icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import { bindStores } from "../../../store/bindStores";
import { useDetailsStore } from "../../../store/detailsStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore, type Entry, type InspectorTab } from "../../../store/inspectorStore";
import { details, land, open, planet, resetStores, SYSTEM } from "../inspectorFixture";
import { READING_STARS } from "../system/StarClassPicker";
import { NEEDS_GAME_DATA, PlanetView } from "./PlanetView";

bindStores();

const STAR = 101;
const WORLD = 100;

/** The install's classes for a binary of a Class A star and a pulsar, and a Class G star. */
function armStarClasses(): void {
  const star = (key: string, ...planet_keys: string[]) => ({
    key,
    texture_key: `star_class:${key}`,
    icon_scale: 1,
    planet_keys,
    crisis_star_class: null,
    spawn_odds: 1,
    localised: true,
  });
  const body = (key: string, isStar = true) => ({
    key,
    icon_sprite: null,
    habitable: !isStar,
    star: isStar,
  });
  useGameDataStore.setState({
    names: new Map([
      ["pc_a_star", "Class A Star"],
      ["pc_g_star", "Class G Star"],
      ["pc_pulsar", "Pulsar"],
    ]),
    starClasses: new Map(
      [
        star("sc_a", "pc_a_star"),
        star("sc_g", "pc_g_star"),
        star("sc_binary_1", "pc_a_star", "pc_pulsar"),
      ].map((c) => [c.key, c]),
    ),
    planetClasses: new Map(
      [body("pc_a_star"), body("pc_g_star"), body("pc_pulsar"), body("pc_continental", false)].map(
        (c) => [c.key, c],
      ),
    ),
  });
}

const stars = () =>
  details({
    planets: [
      planet(WORLD, "Tarkin"),
      planet(STAR, "Alpha", { class: "pc_a_star", size: 30 }),
      planet(102, "Beta", { class: "pc_pulsar" }),
    ],
  });

/** The planet's page on `tab`, drilled onto from its system. */
function page(id: number, tab: InspectorTab = "overview"): string {
  const entry: Entry = { ref: { kind: "planet", id }, label: "Alpha" };
  useInspectorStore.setState({
    stack: [{ ref: { kind: "system", id: SYSTEM }, label: "Alpha Centauri" }, entry],
    tab,
  });
  return renderToStaticMarkup(<PlanetView entry={entry} />);
}

const PICKER = /class="icon-picker-trigger edit-field"[^>]*>/;

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

describe("a save star body's Overview", () => {
  it("opens with its star type and size to edit, then what it is", async () => {
    armStarClasses();
    await open("save");
    await land(stars());

    const html = page(STAR);
    expect(html).toContain('<span class="name">Alpha</span>');
    expect(html).toContain("#101");
    expect(html).toContain('<span class="edit-label">Star type</span>');
    expect(html).toContain('aria-label="Star type: Class A Star"');
    expect(html.match(PICKER)?.[0]).not.toContain("disabled");
    expect(html).toContain('<span class="edit-label">Size</span>');
    expect(html).toMatch(/<input type="number"[^>]*aria-label="Size"[^>]*value="30"/);
    expect(html.indexOf("Star type")).toBeLessThan(html.indexOf("About"));
    expect(html).toContain("Class A Star");
    expect(html).toContain('title="Open the system&#x27;s page"');
    expect(html).toContain("editable · plain text is information");
  });

  it("waits, disabled, while an edit has left the system's details stale", async () => {
    armStarClasses();
    await open("save");
    await land(stars());

    useDetailsStore.getState().invalidate([SYSTEM]);
    const html = page(STAR);
    expect(html.match(PICKER)?.[0]).toContain("disabled");
    expect(html).toContain(READING_STARS.replace("'", "&#x27;"));
  });

  it("says why the star type is disabled without game data", async () => {
    await open("save");
    await land(stars());

    const html = page(STAR);
    expect(html.match(PICKER)?.[0]).toContain("disabled");
    expect(html).toContain(NEEDS_GAME_DATA);
  });

  it("keeps the generic view on the Data tab", async () => {
    armStarClasses();
    await open("save");
    await land(stars());

    expect(page(STAR, "data")).not.toContain("Star type");
  });
});

describe("a planet with no star page", () => {
  it("is the generic view for a planet that is not a star", async () => {
    armStarClasses();
    await open("save");
    await land(stars());

    const html = page(WORLD);
    expect(html).not.toContain("Star type");
    expect(html).toContain("Reading the planet");
  });

  it("is the generic view for a planet no read system lists", async () => {
    armStarClasses();
    await open("save");

    expect(page(STAR)).not.toContain("Star type");
  });

  it("is the generic view on a scenario", async () => {
    armStarClasses();
    await open("scenario");
    await land(stars());

    expect(page(STAR)).not.toContain("Star type");
  });
});
