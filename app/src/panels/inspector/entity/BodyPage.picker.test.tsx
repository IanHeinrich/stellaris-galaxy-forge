import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import type { ClassRolls } from "../../../generated/ClassRolls";
import { CAN_ROLL_TITLE, DEPENDS_ON_CLASS } from "../../../lib/details/spawnFacts";
import { bindStores } from "../../../store/bindStores";
import { useGameDataStore } from "../../../store/gameDataStore";
import { classPickKey, useInspectorStore } from "../../../store/inspectorStore";
import { drawnBy } from "../../../test/drawn";
import { hintOf } from "../../../test/hints";
import { mockedIpc } from "../../../test/ipc";
import { depositRows, poolRows, type ShownPoolRow } from "../../../test/poolRows";
import { classRolls } from "../../../test/rolls";
import { useNameFormatsStore } from "../../../store/nameFormatsStore";
import { depositTypeView, resourceAmount } from "../../../store/fixtures/planet";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { starClassView } from "../../../test/builders";
import { bodySpawn, systemSpawn } from "../../../test/spawn";
import {
  DIE,
  details,
  land,
  open,
  page,
  planet,
  randomPlanet,
  resetStores,
  rolled,
  row,
  SYSTEM,
} from "../inspectorFixture";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
  useNameFormatsStore.setState({ formats: new Map() });
});

describe("a scenario body's class picker", () => {
  const CLASSES = ["pc_desert", "pc_arid", "pc_savannah", "pc_tropical", "pc_toxic", "pc_barren"];

  /** A planet drawn from six classes whose odds are unknown, rolling deposits and features to suit. */
  async function landSix(): Promise<void> {
    usePlanetDataStore.setState({
      depositTypes: new Map([
        [
          "d_minerals_2",
          depositTypeView("d_minerals_2", { yields: [resourceAmount("minerals", 2, "Minerals")] }),
        ],
        [
          "d_energy_3",
          depositTypeView("d_energy_3", { yields: [resourceAmount("energy", 3, "Energy")] }),
        ],
      ]),
    });
    const world = planet(100, "", {
      class: "random",
      drawn: true,
      size: null,
      ring: null,
      spawn: bodySpawn({
        class: {
          state: "rolled",
          pool: {
            kind: "random",
            draw: "random",
            at_orbit: CLASSES.map((c) => ({ class: c, weight: 1 })),
          },
        },
        ring: { state: "unknown" },
        rolled_deposits: {
          state: "rolled",
          entries: ["d_minerals_2", "d_energy_3"].map((key) => ({ key, chance: null })),
        },
        rolled_features: {
          state: "rolled",
          entries: [{ key: "pm_mineral_poor", chance: null }],
        },
      }),
    });
    await open("scenario");
    await land(details({ planets: [world], spawn: systemSpawn() }));
  }

  /** What planet 100 rolls as Toxic World. */
  const TOXIC = classRolls({
    body: 100,
    class: "pc_toxic",
    size: { min: 10, max: 25 },
    ring: { state: "rolled", chance: 0.21 },
    deposits: {
      state: "rolled",
      entries: [
        { key: "d_minerals_2", chance: 0.6 },
        { key: "d_energy_3", chance: 0.3 },
      ],
    },
    features: { state: "rolled", entries: [{ key: "pm_mineral_poor", chance: 0.5 }] },
  });

  /** Picks `className` on planet 100's page as a click does, and lets its read answer. */
  async function pick(className: string | null): Promise<void> {
    useInspectorStore.getState().pickClass(SYSTEM, 100, className);
    await vi.advanceTimersByTimeAsync(0);
  }

  /** Whether a pool row that toggles is pressed. */
  const pressed = (r: ShownPoolRow) => /aria-pressed="(\w+)"/.exec(r.html)?.[1];

  /** The strip's toggle buttons, by what each names, and whether each is pressed. */
  function toggles(html: string): [string, string][] {
    return [
      ...html.matchAll(
        /<button type="button" class="[^"]*"(?: aria-label="([^"]*)")? aria-pressed="(true|false)"/g,
      ),
    ].map(([, name, pressed]) => [name ?? "Any", pressed]);
  }

  it("starts on Any, with every class a toggle and the page as it was", async () => {
    await landSix();

    const html = drawnBy(() => page(100, "Planet"));
    expect(toggles(row(html, "Class"))).toEqual([
      ["Any", "true"],
      ["Desert World", "false"],
      ["Arid World", "false"],
      ["Savannah World", "false"],
      ["Tropical World", "false"],
      ["Toxic", "false"],
      ["Barren", "false"],
    ]);
    expect(hintOf("Toxic")).toBe('<span class="mono">pc_toxic</span>');
    expect(html).not.toContain("If it rolls");
    expect(html).not.toContain('aria-busy="true"');
    expect(row(html, "Size")).toContain(rolled("Suits its class"));
    expect(row(html, "Ring")).toContain(rolled("Suits its class"));
    expect(row(html, "Deposits")).toContain(CAN_ROLL_TITLE);
    expect(row(html, "Planet features")).toContain(CAN_ROLL_TITLE);
    expect(mockedIpc.getClassRolls).not.toHaveBeenCalled();
  });

  it("shows the page as the class picked, with its size, ring chance and pools as a fixed class's", async () => {
    await landSix();
    let answer: (rolls: ClassRolls) => void = () => {};
    mockedIpc.getClassRolls.mockImplementation(
      () => new Promise<ClassRolls>((resolve) => (answer = resolve)),
    );

    await pick("pc_toxic");
    expect(mockedIpc.getClassRolls).toHaveBeenCalledWith(SYSTEM, 100, "pc_toxic");
    const waiting = page(100, "Planet");
    expect(waiting).toContain('<div class="muted ins-hint">If it rolls Toxic</div>');
    expect(waiting).toContain('<div class="ins-class-dependent ins-busy" aria-busy="true">');
    expect(row(waiting, "Deposits")).toContain(CAN_ROLL_TITLE);

    answer(TOXIC);
    await vi.advanceTimersByTimeAsync(0);
    const html = drawnBy(() => page(100, "Planet"));
    expect(toggles(row(html, "Class")).filter(([, pressed]) => pressed === "true")).toEqual([
      ["Toxic", "true"],
    ]);
    expect(html).toContain('<div class="muted ins-hint">If it rolls Toxic</div>');
    expect(html).not.toContain('aria-busy="true"');
    expect(row(html, "Size")).toContain("10 to 25");
    expect(row(html, "Size")).toContain(DIE);
    expect(row(html, "Ring")).toContain(rolled("21% chance"));
    expect(row(html, "Model")).toContain(rolled("Suits its class"));
    expect(html).not.toContain(CAN_ROLL_TITLE);
    expect(html).not.toContain('<span class="k">Deposits</span>');
    expect(html).toContain("Can roll · 2 resources");
    expect(depositRows(html).map((r) => r.title)).toEqual(["Minerals · 60%", "Energy · 30%"]);
    expect(html).toContain("Can roll · 1 planet feature");
    expect(poolRows(html.slice(html.indexOf("1 planet feature"))).map((r) => r.chance)).toEqual([
      "50%",
    ]);
  });

  it("goes back to Any from Any or from the class picked", async () => {
    await landSix();
    mockedIpc.getClassRolls.mockResolvedValue(TOXIC);
    const any = page(100, "Planet");

    await pick("pc_toxic");
    expect(page(100, "Planet")).not.toBe(any);
    await pick(null);
    expect(page(100, "Planet")).toBe(any);
    await pick("pc_toxic");
    await pick("pc_toxic");
    expect(page(100, "Planet")).toBe(any);
  });

  it("says why under the picker when what the class rolls can't be read, and keeps the page on Any's", async () => {
    await landSix();
    mockedIpc.getClassRolls.mockRejectedValue(new Error("body 100 cannot be pc_toxic"));

    await pick("pc_toxic");
    const html = drawnBy(() => page(100, "Planet"));
    const cls = row(html, "Class");
    expect(cls).toContain('<div class="muted ins-hint">If it rolls Toxic</div>');
    expect(cls).toContain("Galaxy Forge can&#x27;t work out what it rolls as Toxic.</span></div>");
    expect(cls).not.toContain("cannot be pc_toxic");
    expect(hintOf("Toxic")).toBe("body 100 cannot be pc_toxic");
    expect(html).not.toContain('aria-busy="true"');
    expect(row(html, "Deposits")).toContain(CAN_ROLL_TITLE);
  });

  it("names each class in the strip to a keyboard, with its card on focus outside the button", async () => {
    await landSix();

    const html = drawnBy(() => page(100, "Planet"));
    const cls = row(html, "Class");
    const strip = cls.slice(cls.indexOf('class="pl-class-strip"'));
    expect(strip).toContain(
      '<button type="button" class="ins-toggle" aria-label="Toxic" aria-pressed="false">',
    );
    expect(strip).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*class="ins-hinted"/);
    expect(strip).not.toContain('tabindex="0"');
  });

  it("shows the planet features and deposits whose odds are unknown in their sections once a class is picked", async () => {
    await landSix();
    mockedIpc.getClassRolls.mockResolvedValue(
      classRolls({
        body: 100,
        class: "pc_toxic",
        deposits: {
          state: "rolled",
          entries: ["d_minerals_2", "d_energy_3"].map((key) => ({ key, chance: null })),
        },
        features: { state: "rolled", entries: [{ key: "pm_mineral_poor", chance: null }] },
      }),
    );

    await pick("pc_toxic");
    const html = page(100, "Planet");
    expect(html).not.toContain(CAN_ROLL_TITLE);
    expect(html).not.toContain('<span class="k">Deposits</span>');
    expect(html).not.toContain('<span class="k">Planet features</span>');
    expect(html).toContain("Can roll · 2 resources");
    expect(html).toContain("Can roll · 1 planet feature");
    expect(html).not.toContain(DEPENDS_ON_CLASS);
  });

  it("ignores a class picked that the list no longer offers", async () => {
    await landSix();
    useInspectorStore.setState({ classPicks: { [classPickKey(SYSTEM, 100)]: "pc_gaia" } });

    const html = page(100, "Planet");
    expect(html).not.toContain("If it rolls");
    expect(toggles(row(html, "Class"))[0]).toEqual(["Any", "true"]);
    expect(mockedIpc.getClassRolls).not.toHaveBeenCalled();
  });

  it("reads what a class rolls once, and forgets the class picked when another document opens", async () => {
    await landSix();
    mockedIpc.getClassRolls.mockResolvedValue(TOXIC);

    await pick("pc_toxic");
    await pick(null);
    await pick("pc_toxic");
    expect(mockedIpc.getClassRolls).toHaveBeenCalledTimes(1);
    expect(page(100, "Planet")).toContain("If it rolls Toxic");

    await landSix();
    expect(useInspectorStore.getState().classPicks).toEqual({});
    expect(page(100, "Planet")).not.toContain("If it rolls");
    await pick("pc_toxic");
    expect(mockedIpc.getClassRolls).toHaveBeenCalledTimes(2);
  });

  it("makes a few classes' rows toggles after an Any row", async () => {
    const few = randomPlanet(100);
    await open("scenario");
    await land(details({ planets: [few], spawn: systemSpawn() }));
    mockedIpc.getClassRolls.mockResolvedValue(classRolls({ body: 100, class: "pc_barren" }));

    await pick("pc_barren");
    const rows = poolRows(row(page(100, "Planet"), "Class"));
    expect(rows.map((r) => [r.name.toLowerCase(), pressed(r)])).toEqual([
      ["any", "false"],
      [expect.stringContaining("barren"), "true"],
      [expect.stringContaining("toxic"), "false"],
    ]);
    expect(rows.every((r) => r.html.includes('role="button" tabindex="0"'))).toBe(true);
  });

  it("gives a star of a rolled list the same picker over its odds, asking as its star's class", async () => {
    useGameDataStore.setState({
      starClasses: new Map([
        ["sc_k", starClassView("sc_k", "pc_k_star")],
        ["sc_g", starClassView("sc_g", "pc_g_star")],
      ]),
    });
    const star = planet(99, "", {
      class: "pc_k_star",
      star_class: "sc_k",
      role: "primary",
      spawn: bodySpawn({
        class: { state: "rolled", pool: { kind: "star_list", list: "rl_pair" } },
      }),
    });
    const spawn = systemSpawn({
      star: {
        state: "rolled",
        list: "rl_pair",
        members: [
          { key: "sc_k", weight: 1 },
          { key: "sc_g", weight: 3 },
        ],
      },
    });
    await open("scenario");
    await land(details({ planets: [star], spawn }));
    mockedIpc.getClassRolls.mockResolvedValue(
      classRolls({ body: 99, class: "pc_g_star", size: { min: 30, max: 30 } }),
    );

    useInspectorStore.getState().pickClass(SYSTEM, 99, "pc_g_star");
    await vi.advanceTimersByTimeAsync(0);
    const html = page(99, "Star");
    expect(mockedIpc.getClassRolls).toHaveBeenCalledWith(SYSTEM, 99, "pc_g_star");
    const rows = poolRows(row(html, "Class"));
    expect(rows.map((r) => [r.name, r.chance, pressed(r)])).toEqual([
      ["Any", "", "false"],
      ["sc_g", "75%", "true"],
      ["sc_k", "25%", "false"],
    ]);
    expect(html).toContain("If it rolls sc_g");
    expect(row(html, "Size")).toContain(">30</span>");
  });

  it("gives a toggle only to the first of the star classes that ask as one planet class", async () => {
    useGameDataStore.setState({
      starClasses: new Map([
        ["sc_k", starClassView("sc_k", "pc_k_star")],
        ["sc_g", starClassView("sc_g", "pc_g_star")],
        ["sc_g_giant", starClassView("sc_g_giant", "pc_g_star")],
      ]),
    });
    const star = planet(99, "", {
      class: "pc_k_star",
      star_class: "sc_k",
      role: "primary",
      spawn: bodySpawn({
        class: { state: "rolled", pool: { kind: "star_list", list: "rl_three" } },
      }),
    });
    const spawn = systemSpawn({
      star: {
        state: "rolled",
        list: "rl_three",
        members: [
          { key: "sc_k", weight: 1 },
          { key: "sc_g", weight: 3 },
          { key: "sc_g_giant", weight: 2 },
        ],
      },
    });
    await open("scenario");
    await land(details({ planets: [star], spawn }));
    mockedIpc.getClassRolls.mockResolvedValue(classRolls({ body: 99, class: "pc_g_star" }));

    useInspectorStore.getState().pickClass(SYSTEM, 99, "pc_g_star");
    await vi.advanceTimersByTimeAsync(0);
    const rows = poolRows(row(page(99, "Star"), "Class"));
    expect(rows.map((r) => [r.name, pressed(r)])).toEqual([
      ["Any", "false"],
      ["sc_g", "true"],
      ["sc_g_giant", undefined],
      ["sc_k", "false"],
    ]);
  });
});
