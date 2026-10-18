import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { bindStores } from "../../store/bindStores";
import { editResult, OPEN_RESULT } from "../../store/fixture";
import { useGameDataStore } from "../../store/gameDataStore";
import { useGeneratorStore } from "../../store/generatorStore";
import { specialLinksNow } from "../../store/specialLinks";
import { useSpecialPickerStore } from "../../store/specialPickerStore";
import { useStarBuilderStore } from "../../store/starBuilderStore";
import { armSession, resetStores } from "../../store/storeFixture";
import { arrangement, starClassesOf, starType } from "../../test/builders";
import { drawnBy, drawnButton, lastDrawn } from "../../test/drawn";
import { flush } from "../../test/flush";
import { mockedIpc } from "../../test/ipc";
import { stubPrefs } from "../../test/prefs";
import { openWith } from "../../test/session";
import { until } from "../../test/wait";
import { StarDiagram } from "../StarDiagram";
import { StarBuilder } from "./StarBuilder";

bindStores();

const stored = new Map<string, string>();
const PAIR = arrangement("binary_1", 2, "Close pair", 0.6);
const COMPANION = arrangement("binary_2", 2, "Distant companion", 0.4, {
  shape: "distant_companion",
  diagram: {
    stars: [
      { x: 0, y: 0, orbit: 0, distant: false },
      { x: 120, y: 0, orbit: 120, distant: true },
    ],
  },
});
const TRIO = arrangement("trinary_1", 3, "Close trio", 1);
const TYPES = ["pc_a_star", "pc_black_hole", "pc_m_star", "pc_k_star"].map((key) => starType(key));

const builder = () => useStarBuilderStore.getState();
const slots = () => useStarBuilderStore.getState().stars;
const render = () => drawnBy(() => renderToStaticMarkup(<StarBuilder />));

/**
 * Submits the builder's form, as Place and Enter do: Place is its submit button, and the dialog
 * submits its form on Enter.
 */
function submit() {
  render();
  expect((drawnButton("Place") as { type?: string }).type).toBe("submit");
  const form = lastDrawn(({ type }) => type === "form", "the builder's form") as {
    onSubmit(e: { preventDefault(): void }): void;
  };
  form.onSubmit({ preventDefault: vi.fn() });
}

const linksAt = (x: number, y: number) =>
  specialLinksNow({ places: [{ x, y, star_class: null, refused: null }], lanes: [] }).map(
    ([, system]) => system,
  );

/** Opens the builder at the world point `at` once the arrangements and star types are read. */
async function openBuilder(at = { x: -50, y: -20 }) {
  builder().openAt(at, { x: 400, y: 300 });
  await until(() => expect(useGeneratorStore.getState().starTypes).not.toBeNull());
}

beforeEach(async () => {
  resetStores();
  stubPrefs(stored);
  armSession();
  await openWith(OPEN_RESULT);
  useGameDataStore.setState({
    status: "ready",
    ...starClassesOf({
      sc_a: ["pc_a_star"],
      sc_black_hole: ["pc_black_hole"],
      sc_pair_mk: ["pc_m_star", "pc_k_star"],
      sc_trio: ["pc_a_star", "pc_m_star", "pc_k_star"],
    }),
  });
  mockedIpc.getStarArrangements.mockResolvedValue([PAIR, COMPANION, TRIO]);
  mockedIpc.getStarTypes.mockResolvedValue(TYPES);
  mockedIpc.fileStarClass.mockResolvedValue("sc_a");
  mockedIpc.addBuiltSystem.mockResolvedValue(editResult({ delta: { systems: [] } }));
});

describe("the builder", () => {
  it("draws nothing until Build one… opens it, then opens beside the point with no scrim", async () => {
    expect(render()).toBe("");
    await openBuilder();
    const html = render();
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-label="Build a binary or trinary"/);
    expect(html).not.toContain("browse-scrim");
    expect(html).toContain("Planets are generated to suit the stars you choose.");
    expect(html).toContain("New system at -50.00, -20.00");
    const numbers = [...html.matchAll(/class="star-diagram-label"[^>]*>([^<]+)</g)].map(
      (m) => m[1],
    );
    expect(numbers).toEqual(["1", "2"]);
    expect(html).not.toContain("browse-detail-name");
  });

  it("gives the arrangement as many slots as it has stars, keeping the first two from a trio", async () => {
    await openBuilder();
    builder().setLayout(TRIO.layout);
    expect(slots()).toHaveLength(3);
    builder().setStar(0, "pc_black_hole");
    builder().setStar(2, "pc_k_star");
    expect(slots()).toEqual(["pc_black_hole", "pc_a_star", "pc_k_star"]);

    builder().setLayout(COMPANION.layout);
    expect(slots().slice(0, 2)).toEqual(["pc_black_hole", "pc_a_star"]);
    expect(JSON.parse(stored.get("sgf.starBuilder.last") ?? "null")).toEqual({
      layout: COMPANION.layout,
      stars: ["pc_black_hole", "pc_a_star", "pc_k_star"],
    });
  });

  it("shows a pair's third slot greyed and disabled, the third star kept for a trio again", async () => {
    await openBuilder();
    builder().setLayout(TRIO.layout);
    builder().setStar(2, "pc_k_star");
    expect(render()).not.toContain("sb-slot off");

    builder().setLayout(PAIR.layout);
    const pair = render();
    expect(pair).toContain('class="sb-slot off"');
    expect(pair).toMatch(/<button[^>]*aria-label="Star 3: Named pc_k_star"[^>]*disabled=""/);
    expect(pair).not.toMatch(/<button[^>]*aria-label="Star 2: [^"]*"[^>]*disabled=""/);

    builder().setStar(0, "pc_m_star");
    builder().setLayout(TRIO.layout);
    expect(render()).not.toContain("sb-slot off");
    expect(builder().stars).toEqual(["pc_m_star", "pc_a_star", "pc_k_star"]);
  });

  it("shows the first star in a pair's third slot where there never was a third", async () => {
    useStarBuilderStore.setState({ layout: PAIR.layout, stars: ["pc_m_star", "pc_k_star"] });
    await openBuilder();
    expect(render()).toMatch(/aria-label="Star 3: Named pc_m_star"[^>]*disabled=""/);
  });

  it("sends only a pair's two stars on Place and to be filed", async () => {
    await openBuilder();
    builder().setLayout(TRIO.layout);
    builder().setStar(2, "pc_k_star");
    builder().setLayout(PAIR.layout);
    render();
    submit();
    await until(() => expect(builder().open).toBe(false));
    expect(mockedIpc.addBuiltSystem.mock.calls[0][3]).toMatchObject({
      layout: PAIR.layout,
      stars: ["pc_a_star", "pc_a_star"],
    });
    const asked = mockedIpc.fileStarClass.mock.calls.map(([stars]) => stars);
    expect(asked[asked.length - 1]).toEqual(["pc_a_star", "pc_a_star"]);
  });

  it("fills the slots from one of the game's own sets, offered for as many stars", async () => {
    await openBuilder();
    builder().setLayout(PAIR.layout);
    const html = render();
    expect(html).toContain("The game&#x27;s pairs");
    expect(html).not.toContain("The game&#x27;s trios");
    const chips = [...html.matchAll(/class="sb-chip"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(chips).toEqual(["pc_m_star + pc_k_star"]);
    expect(html).toContain('title="Named pc_m_star + Named pc_k_star"');
    drawnButton(chips[0]).onClick();
    expect(slots()).toEqual(["pc_m_star", "pc_k_star"]);
  });

  it("names the map icon by its class alone, the automatic one clearing the choice and another setting it", async () => {
    const { starClasses } = useGameDataStore.getState();
    useGameDataStore.setState({
      starClasses: new Map(
        [...starClasses].map(([k, v]) => [
          k,
          {
            ...v,
            fileable: true,
            modifiers: k === "sc_a" ? [{ key: "slow", name: "Sublight Speed Reduction" }] : [],
          },
        ]),
      ),
    });
    await openBuilder();
    builder().setLayout(PAIR.layout);
    await until(() => expect(useGeneratorStore.getState().filed.size).toBeGreaterThan(0));
    const label = "Shows on the galaxy map as";
    const html = render();
    expect(html).not.toContain("(automatic)");
    expect(html).toMatch(new RegExp(`aria-label="${label}: [^"]*"`));
    const pick = lastDrawn(
      ({ props }) => props.label === label && typeof props.onPick === "function",
      label,
    ) as { items: { key: string }[]; current: { key: string }; onPick(key: string): void };
    expect(pick.items.map((i) => i.key)).toEqual([
      "sc_a",
      "sc_black_hole",
      "sc_pair_mk",
      "sc_trio",
    ]);
    expect(pick.current.key).toBe("sc_a");
    expect(pick.current).not.toHaveProperty("note", expect.anything());
    expect(html).not.toContain("Sublight Speed Reduction");
    expect(pick.items.find((i) => i.key === "sc_a")).toHaveProperty("note");

    pick.onPick("sc_black_hole");
    expect(builder().starClass).toBe("sc_black_hole");
    render();
    const again = lastDrawn(
      ({ props }) => props.label === label && typeof props.onPick === "function",
      label,
    ) as { current: { key: string }; onPick(key: string): void };
    expect(again.current.key).toBe("sc_black_hole");
    again.onPick("sc_a");
    expect(builder().starClass).toBeNull();
  });

  it("holds the room of the other count's chips, empty, so a pair and a trio are as tall", async () => {
    await openBuilder();
    builder().setLayout(PAIR.layout);
    const pair = render();
    expect(pair.match(/class="sb-chip held"/g)).toHaveLength(1);
    builder().setLayout(TRIO.layout);
    const trio = render();
    expect(trio.match(/class="sb-chip held"/g)).toHaveLength(1);
    expect(trio).toContain("The game&#x27;s trios");
    expect(trio).not.toContain("The game&#x27;s pairs");
  });

  it("asks which class the stars are filed under each time they change", async () => {
    await openBuilder();
    builder().setLayout(PAIR.layout);
    builder().setStar(1, "pc_black_hole");
    builder().fillStars(["pc_m_star", "pc_k_star"]);
    const asked = mockedIpc.fileStarClass.mock.calls.map(([stars]) => stars);
    expect(asked).toContainEqual(["pc_a_star", "pc_black_hole"]);
    expect(asked).toContainEqual(["pc_m_star", "pc_k_star"]);
    await flush();
    expect(useGeneratorStore.getState().filed.get("pc_m_star+pc_k_star")).toEqual({
      kind: "filed",
      starClass: "sc_a",
    });
  });

  it("adds the stars on Place with a fresh seed, no class of its own unless chosen, and planets", async () => {
    await openBuilder();
    builder().setLayout(COMPANION.layout);
    builder().fillStars(["pc_black_hole", "pc_k_star"]);
    submit();
    await until(() => expect(builder().open).toBe(false));

    const [seed, x, y, built, links] = mockedIpc.addBuiltSystem.mock.calls[0];
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect([x, y]).toEqual([-50, -20]);
    expect(built).toEqual({
      layout: COMPANION.layout,
      stars: ["pc_black_hole", "pc_k_star"],
      starClass: null,
      planets: true,
    });
    expect(links).toEqual([]);

    await openBuilder();
    builder().setStarClass("sc_black_hole");
    builder().setNoPlanets(true);
    expect(stored.get("sgf.starBuilder.noPlanets")).toBe("true");
    useSpecialPickerStore.getState().setJoin(true);
    submit();
    await until(() => expect(mockedIpc.addBuiltSystem).toHaveBeenCalledTimes(2));
    const [, , , second, joined] = mockedIpc.addBuiltSystem.mock.calls[1];
    expect(second).toMatchObject({ starClass: "sc_black_hole", planets: false });
    expect(joined).toEqual(linksAt(-50, -20));
    expect(joined.length).toBeGreaterThan(0);
  });

  it("places nothing where the spot is refused, with Place disabled and saying why", async () => {
    await openBuilder({ x: 3, y: 0 });
    render();
    const place = drawnButton("Place") as { disabled?: boolean; title?: string };
    expect(place.disabled).toBe(true);
    expect(place.title).toMatch(/^Too close to .+: 3 away, the game needs 10$/);
    submit();
    await flush();
    expect(mockedIpc.addBuiltSystem).not.toHaveBeenCalled();
    expect(builder().open).toBe(true);
  });

  it("leaves out a remembered star the install no longer offers", async () => {
    useStarBuilderStore.setState({ layout: PAIR.layout, stars: ["pc_mod_star", "pc_m_star"] });
    await openBuilder();
    const html = render();
    expect(html).toContain('aria-label="Star 1: Named pc_m_star"');
    expect(html).toContain('aria-label="Star 2: Named pc_m_star"');
  });

  it("starts with Join unticked, shared with the Special picker", async () => {
    expect(useSpecialPickerStore.getState().join).toBe(false);
    expect(builder().noPlanets).toBe(false);
    await openBuilder();
    useSpecialPickerStore.getState().setJoin(true);
    expect(stored.get("sgf.special.join")).toBe("true");
  });
});

describe("a stars-only diagram", () => {
  it("draws each star at its place, a distant companion with its path", () => {
    const html = renderToStaticMarkup(
      <StarDiagram
        diagram={COMPANION.diagram}
        stars={["pc_black_hole", "pc_k_star"]}
        size={100}
        starSize={20}
      />,
    );
    const lefts = [
      ...html.matchAll(/class="star-diagram-star" style="left:([\d.]+)px;top:([\d.]+)px/g),
    ];
    expect(lefts.map((m) => [Number(m[1]), Number(m[2])])).toEqual([
      [40, 40],
      [78, 40],
    ]);
    expect(html.match(/class="star-diagram-path"/g)).toHaveLength(1);
  });
});
