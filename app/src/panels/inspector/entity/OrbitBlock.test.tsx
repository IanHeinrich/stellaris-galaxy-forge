import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The star icons and deposit art come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import type { PlanetPage } from "../../../generated/PlanetPage";
import { bindStores } from "../../../store/bindStores";
import { name, editResult, planetPage } from "../../../store/fixture";
import { useGameDataStore } from "../../../store/gameDataStore";
import { land, open, resetStores, SYSTEM } from "../inspectorFixture";
import { orbitClasses, orbitSystem, saveBody } from "../../../test/builders";
import { drawnBy, drawnField } from "../../../test/drawn";
import { mockedIpc } from "../../../test/ipc";
import { PickerField, ToggleField } from "../../EditField";
import { GEOMETRY_REASONS } from "../../../lib/details/orbitIntent";
import { landPage, answerPage, render } from "./bodyPageFixture";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

describe("a body's orbit", () => {
  const PLANET = 2;
  const MOON = 3;
  const LONE = 5;

  /** The orbit fixture's system as system `SYSTEM`, its ringed planet named Sol III. */
  async function landOrbits(): Promise<void> {
    const read = orbitSystem({ id: SYSTEM, with_game_data: true });
    read.planets = read.planets.map((p) =>
      p.id === PLANET ? { ...p, name: name("Sol_III"), name_key: "Sol_III" } : p,
    );
    useGameDataStore.setState({ planetClasses: orbitClasses() });
    await land(read);
  }

  const bodyPage = (id: number, over: Partial<PlanetPage> = {}) =>
    landPage(planetPage({ id, class: "pc_arid", ...over }));

  it("opens with what the body orbits, its radius and its angle to edit, read from the layout", async () => {
    await open("save");
    await landOrbits();
    await bodyPage(LONE, { orbit: 999 });

    const html = drawnBy(() => render(LONE));
    expect(html).toContain('aria-label="Orbit"');
    expect(html).toContain('aria-label="Orbits: The star"');
    expect(html).toMatch(/<input type="number"[^>]*aria-label="Orbit radius"[^>]*value="100"/);
    expect(html).toMatch(/<input type="number"[^>]*aria-label="Angle"[^>]*value="120"/);
    expect(html).not.toContain("999");
    expect(html).not.toContain("Measured from");
    expect(html).toContain("editable · plain text is information");
    expect(html.indexOf("Orbit radius")).toBeLessThan(html.indexOf("About"));

    const orbits = drawnField(PickerField, "Orbits");
    expect(orbits.items.map((item) => item.label)).toEqual(["The star", "Sol III"]);
    mockedIpc.applyOp.mockResolvedValue(editResult());
    orbits.onPick(String(PLANET));
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SetBodyParent",
        body: LONE,
        parent: { Body: PLANET },
        radius: 25,
      }),
    );
  });

  it("says a moon's orbit is measured from its planet, and offers no picker to a planet with moons", async () => {
    await open("save");
    await landOrbits();
    await bodyPage(MOON, { parent: PLANET });
    await bodyPage(PLANET);

    const moon = render(MOON);
    expect(moon).toContain("Measured from Sol III");
    expect(moon).toContain('aria-label="Orbits: Sol III"');
    expect(moon).toMatch(/aria-label="Orbit radius"[^>]*value="15"/);
    expect(moon).toMatch(/Orbits<\/span>.*?Sol III/);

    const planet = render(PLANET);
    expect(planet).toMatch(/aria-label="Orbit radius"[^>]*value="60"/);
    expect(planet).not.toContain('aria-label="Orbits:');
  });

  it("offers a planet with moons the companion star, and a planet named to the centre's star the star", async () => {
    await open("save");
    const read = orbitSystem({ id: SYSTEM, with_game_data: true });
    const companion = saveBody(8, "pc_g_star", [-240, 0], 240, 20);
    read.planets.push({ ...companion, name: name("Sol_B"), name_key: "Sol_B" });
    read.planets.push(saveBody(9, "pc_arid", [0, -140], 140, 10, 1));
    useGameDataStore.setState({ planetClasses: orbitClasses() });
    await land(read);
    await bodyPage(9, { parent: 1 });
    expect(render(9)).toContain('aria-label="Orbits: The star"');

    await bodyPage(PLANET);
    render(PLANET);
    const orbits = drawnField(PickerField, "Orbits");
    expect(orbits.items.map((item) => item.label)).toEqual(["The star", "Sol B"]);
    mockedIpc.applyOp.mockResolvedValue(editResult());
    orbits.onPick("8");
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SetBodyParent",
        body: PLANET,
        parent: { Body: 8 },
        radius: 30,
      }),
    );
  });

  it("offers a moon whose planet is missing only the star, detaching it where it stands", async () => {
    await open("save");
    const read = orbitSystem({ id: SYSTEM, with_game_data: true });
    read.planets.push(saveBody(58, "pc_barren", [100, 20], 10, 6, 57));
    useGameDataStore.setState({ planetClasses: orbitClasses() });
    await land(read);
    await bodyPage(58, { parent: 57 });

    const html = drawnBy(() => render(58));
    expect(html).toContain('aria-label="Orbits: #57"');
    expect(html).not.toContain("Orbit radius");
    expect(html).toContain(GEOMETRY_REASONS.noOrbit);
    const orbits = drawnField(PickerField, "Orbits");
    expect(orbits.items.map((item) => item.label)).toEqual(["The star"]);
    mockedIpc.applyOp.mockResolvedValue(editResult());
    orbits.onPick("star");
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SetBodyParent",
        body: 58,
        parent: "Centre",
        radius: expect.closeTo(Math.hypot(100, 20), 6),
        angle: expect.closeTo((Math.atan2(20, 100) * 180) / Math.PI, 6),
      }),
    );
  });

  it("reads the system first, and shows no orbit fields to edit on a scenario", async () => {
    await open("save");
    await answerPage(planetPage({ id: LONE, class: "pc_arid" }));
    expect(render(LONE)).toContain("Reading the system…");

    await open("scenario");
    await landOrbits();
    const html = render(LONE);
    expect(html).not.toMatch(/<input[^>]*aria-label="Orbit radius"/);
    expect(html).not.toContain("Reading the system…");
  });
});

describe("a body's ring", () => {
  const STAR_BODY = 1;
  const PLANET = 2;
  const MOON = 3;
  const ASTEROID = 6;
  const RING =
    /<label class="edit-label" for="[^"]+"[^>]*>Ring<\/label><span class="edit-cell"><span class="edit-field edit-toggle"[^>]*><input id="[^"]+" type="checkbox"( checked="")?\/>/;

  /** The orbit fixture's system as system `SYSTEM`, its planet with a ring. */
  async function landRinged(): Promise<void> {
    const read = orbitSystem({ id: SYSTEM, with_game_data: true });
    read.planets = read.planets.map((p) => (p.id === PLANET ? { ...p, ring: true } : p));
    useGameDataStore.setState({ planetClasses: orbitClasses() });
    await land(read);
  }

  const bodyPage = (id: number, over: Partial<PlanetPage> = {}) =>
    landPage(planetPage({ id, class: "pc_arid", ...over }));

  it("shows a planet's ring checked and a moon's unchecked, and a tick sends the ring", async () => {
    await open("save");
    await landRinged();
    await bodyPage(MOON, { class: "pc_barren", parent: PLANET });
    await bodyPage(PLANET, { class: "pc_continental" });

    expect(render(MOON).match(RING)?.[1]).toBeUndefined();
    const html = drawnBy(() => render(PLANET));
    expect(html).toContain('aria-label="Planet"');
    expect(html.match(RING)?.[1]).toBe(' checked=""');

    mockedIpc.applyOp.mockResolvedValue(editResult());
    drawnField(ToggleField, "Ring").onChange(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "SetBodyRing",
      body: PLANET,
      ring: false,
    });
  });

  it("offers no ring to a star or an asteroid", async () => {
    await open("save");
    await landRinged();
    await bodyPage(STAR_BODY, { class: "pc_g_star" });
    await bodyPage(ASTEROID, { class: "pc_asteroid" });

    for (const id of [STAR_BODY, ASTEROID]) {
      const html = render(id);
      expect(html).toContain("About");
      expect(html).not.toMatch(RING);
    }
  });

  it("offers no ring on a scenario", async () => {
    await open("scenario");
    await landRinged();
    await bodyPage(PLANET, { class: "pc_continental" });

    expect(render(PLANET)).not.toMatch(RING);
  });
});
