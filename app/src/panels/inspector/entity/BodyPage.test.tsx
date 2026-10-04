import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../api/__mocks__/dialog"));
// The star icons and deposit art come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import * as ipc from "../../../api/ipc";
import type { DocumentKind } from "../../../generated/DocumentKind";
import { SAVE_CAPABILITIES } from "../../../lib/capabilities";
import { DETAILS_DEBOUNCE_MS } from "../../../store/batching";
import { bindStores } from "../../../store/bindStores";
import { useDetailsStore } from "../../../store/detailsStore";
import { planetPageKey, useEntityStore } from "../../../store/entityStore";
import { name, planetPage } from "../../../store/fixture";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore } from "../../../store/inspectorStore";
import { bodyLayout } from "../../../test/builders";
import { drawnBy, lastDrawn } from "../../../test/drawn";
import { mockedIpc } from "../../../test/ipc";
import { DrillRow } from "../parts";
import { details, land, open, overview, planet, resetStores, SYSTEM } from "../inspectorFixture";
import {
  GENERIC_HEAD,
  STAR,
  WORLD,
  armStarClasses,
  stars,
  landPage,
  answerPage,
  render,
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

describe("a body's name", () => {
  it("names an unnamed body alike in its system's list, on its page and where a moon orbits it", async () => {
    await open("save");
    useGameDataStore.setState({ status: "idle" });
    const unnamed = { name: name(""), name_key: "", class: "pc_tropical" };
    await land(
      details({
        planets: [
          planet(WORLD, "", unnamed),
          planet(745, "Nekkar_a", { class: "pc_barren_cold", moon: true }),
        ],
      }),
    );
    await landPage(planetPage({ id: WORLD, ...unnamed }));
    await landPage(planetPage({ id: 745, class: "pc_barren_cold", parent: WORLD }));

    expect(overview()).toContain("Tropical World");
    expect(render(WORLD)).toContain('<span class="name">Tropical World</span>');
    expect(render(745)).toMatch(/Orbits<\/span>.*?Tropical World/);
  });
});

describe("a planet with no page of its own", () => {
  it("is the scenario's body page on a scenario, with nothing of the save's to edit", async () => {
    armStarClasses();
    await open("scenario");
    await land(stars());
    await armStar();

    const html = render(STAR);
    expect(html).toContain('<span class="name">Alpha</span>');
    expect(html).not.toContain(GENERIC_HEAD);
    expect(html).not.toContain("Star type");
    expect(html).not.toContain("Deposits");
  });

  function armStar(): Promise<void> {
    return landPage(
      planetPage({
        id: STAR,
        class: "pc_a_star",
        deposits: [{ id: 1, kind: "d_energy_2", swap_type: null }],
      }),
    );
  }

  it("is the generic view when the save cannot answer for the planet", async () => {
    await open("save");
    vi.mocked(ipc.getPlanetPage).mockRejectedValueOnce(new Error("planet #100 not found"));
    useEntityStore.getState().requestPlanetPage(WORLD);
    await vi.waitFor(() =>
      expect(useEntityStore.getState().errors.has(planetPageKey(WORLD))).toBe(true),
    );

    const html = render(WORLD);
    expect(html).not.toContain("Deposits");
    expect(html).toContain(GENERIC_HEAD);
  });
});

/**
 * What a save's page edits, a scenario's page shows read from the initializer. Each case runs once
 * per kind on the same world: Nekkar I, an arctic world with a ring, two mineral fields and a moon.
 */
const KINDS: readonly { kind: DocumentKind; edits: boolean }[] = [
  { kind: "save", edits: true },
  { kind: "scenario", edits: false },
];

describe.each(KINDS)("a $kind body's shared fields", ({ kind, edits }) => {
  const MOON = 745;
  const fixed = (n: number) => ({ min: n, max: n });

  async function arm(): Promise<void> {
    await open(kind);
    useGameDataStore.setState({
      names: new Map([
        ["pc_arctic", "Arctic World"],
        ["pc_barren_cold", "Barren World"],
      ]),
    });
    const world = planet(WORLD, "Nekkar_I", {
      class: "pc_arctic",
      size: 16,
      ring: true,
      deposit_keys: [{ key: "d_mineral_fields", count: 2 }],
      layout: bodyLayout({
        orbit: fixed(60),
        at: kind === "save" ? [60, 0] : null,
        size: fixed(16),
      }),
    });
    const moon = planet(MOON, "Nekkar_I_a", {
      class: "pc_barren_cold",
      moon: true,
      parent: WORLD,
      size: 8,
    });
    await land(details({ planets: [world, moon] }));
    if (kind === "save") {
      await answerPage(
        planetPage({
          id: WORLD,
          name: name("Nekkar_I"),
          name_key: "Nekkar_I",
          class: "pc_arctic",
          deposits: [
            { id: 1, kind: "d_mineral_fields", swap_type: null },
            { id: 2, kind: "d_mineral_fields", swap_type: null },
          ],
        }),
      );
    }
  }

  it("heads the page with the body's name, and a save's entity id", async () => {
    await arm();
    const html = render(WORLD);
    expect(html).toContain('<span class="name">Nekkar I</span>');
    expect(html.includes(`#${WORLD}`)).toBe(edits);
  });

  it("shows its class, as a field where the document edits classes", async () => {
    await arm();
    const html = render(WORLD);
    expect(html.includes('<span class="edit-label">Class</span>')).toBe(edits);
    expect(html.includes('<span class="k">Class</span><span>Arctic World</span>')).toBe(!edits);
  });

  it("shows its size, as a field where the document edits sizes", async () => {
    await arm();
    const html = render(WORLD);
    expect(/<input type="number"[^>]*aria-label="Size"[^>]*value="16"/.test(html)).toBe(edits);
    expect(/<span class="k">Size<\/span><span><span class="sz">.*16<\/span>/.test(html)).toBe(
      !edits,
    );
  });

  it("shows its ring, as a checkbox where the document edits rings", async () => {
    await arm();
    const html = render(WORLD);
    expect(html.includes('<input type="checkbox" checked=""/>Ring</label>')).toBe(edits);
    expect(html.includes('<span class="k">Ring</span><span>Yes</span>')).toBe(!edits);
  });

  it("shows its orbit, as fields where the document moves bodies", async () => {
    await arm();
    const html = render(WORLD);
    expect(/<input type="number"[^>]*aria-label="Orbit radius"[^>]*value="60"/.test(html)).toBe(
      edits,
    );
    expect(html.includes('<span class="k">Orbit radius</span><span>60</span>')).toBe(!edits);
    expect(html).toContain('title="Open the system&#x27;s page"');
  });

  it("lists its deposits by type, each removable where the document edits deposits", async () => {
    await arm();
    const html = render(WORLD);
    expect(html).toContain("Deposits · 2");
    expect(html).toContain('<span class="l1 mono">d_mineral_fields</span>');
    expect(html).toContain("×2");
    expect(html.includes('aria-label="Remove d_mineral_fields"')).toBe(edits);
    expect(html.includes("+ Add deposit…")).toBe(edits);
  });

  it("lists its moons, each opening its own page", async () => {
    await arm();
    const html = drawnBy(() => render(WORLD));
    expect(html).toContain("Moons · 1");
    expect(html).toContain("Nekkar I a");
    (lastDrawn((el) => el.type === DrillRow, "the moon's row") as { onOpen(): void }).onOpen();
    const { stack } = useInspectorStore.getState();
    expect(stack[stack.length - 1].ref).toEqual({ kind: "body", system: SYSTEM, id: MOON });
  });
});

describe("a save body its system's details can't list", () => {
  const NEKKAR = planetPage({
    id: WORLD,
    name: name("Nekkar_I"),
    name_key: "Nekkar_I",
    class: "pc_arctic",
    parent: STAR,
    deposits: [{ id: 1, kind: "d_mineral_fields", swap_type: null }],
    moons: [
      { id: 745, name: name("Nekkar_I_a"), name_key: "Nekkar_I_a", class: "pc_frozen", size: 6 },
    ],
  });

  /** Nekkar I's page as the save reads it, with its system's details as `arm` leaves them. */
  function expectDrawnFromItsPage(): void {
    const html = render(WORLD);
    expect(html).toContain('<span class="name">Nekkar I</span>');
    expect(html).toMatch(/<input type="text" aria-label="Name"/);
    expect(html).toContain("Deposits · 1");
    expect(html).toContain('aria-label="Remove d_mineral_fields"');
    expect(html).toContain("+ Add modifier…");
    expect(html).toContain("Moons · 1");
    expect(html).toContain("Nekkar I a");
    expect(html).not.toContain("Reading the");
    expect(html).not.toMatch(/Ring/);
  }

  it("shows its page from the save's own read when the details fail to read", async () => {
    await open("save");
    mockedIpc.getSystemDetails.mockRejectedValue(new Error("details failed"));
    useDetailsStore.getState().request([SYSTEM]);
    await vi.advanceTimersByTimeAsync(DETAILS_DEBOUNCE_MS);
    expect(useDetailsStore.getState().failed.has(SYSTEM)).toBe(true);
    await answerPage(NEKKAR);

    expectDrawnFromItsPage();
  });

  it("shows its page from the save's own read when the details don't list it", async () => {
    await open("save");
    await land(details({ planets: [planet(STAR, "Alpha", { class: "pc_a_star" })] }));
    await answerPage(NEKKAR);

    expectDrawnFromItsPage();
  });

  it("heads the page with the save's entity id while it reads", async () => {
    await open("save");
    const html = render(WORLD);
    expect(html).toContain("Reading the planet…");
    expect(html).toContain(`#${WORLD}`);
  });
});

describe("a save body's orbit radius", () => {
  it("shows beside what it orbits, where no Orbit block edits it", async () => {
    await open("save");
    useFileSessionStore.setState({ capabilities: { ...SAVE_CAPABILITIES, geometry: false } });
    await land(
      details({
        planets: [
          planet(STAR, "Alpha", { class: "pc_a_star" }),
          planet(WORLD, "Nekkar_I", {
            layout: bodyLayout({ orbit: { min: 60, max: 60 }, at: [60, 0] }),
          }),
        ],
      }),
    );
    await answerPage(planetPage({ id: WORLD, parent: STAR }));

    const html = render(WORLD);
    expect(html).toMatch(
      /Orbits<\/span><span><button[^>]*>Alpha ›<\/button><span class="muted"> radius 60<\/span>/,
    );
    expect(html).not.toContain('<span class="k">Orbit radius</span>');
  });
});
