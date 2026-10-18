import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import { useGameDataStore } from "../../../store/gameDataStore";
import { useMapChromeStore } from "../../../store/mapChromeStore";
import { useStarBuilderStore } from "../../../store/starBuilderStore";
import { drawnBy, lastDrawn } from "../../../test/drawn";
import { resetStores } from "../../../store/storeFixture";
import { starClassView } from "../../../test/builders";
import { MultiStarRows, StarClassItems } from "./AddSystemItems";

beforeEach(() => {
  resetStores();
  useGameDataStore.setState({
    starClasses: new Map(
      [
        starClassView("sc_g", "pc_g_star"),
        starClassView("sc_m", "pc_m_star"),
        starClassView("sc_pair", "pc_b_star", "pc_neutron_star"),
        starClassView("sc_trinary_1", "pc_g_star", "pc_m_star", "pc_k_star"),
      ].map((c) => [c.key, c]),
    ),
  });
});

/** Each menu entry of `html`, as its text. */
function texts(html: string): string[] {
  return [...html.matchAll(/<button type="button" role="menuitem"[^>]*>(.*?)<\/button>/g)].map(
    (m) => m[1].replace(/<[^>]*>/g, ""),
  );
}

/** The menu's entries for `keys` offered, each as its text. */
function entries(...keys: string[]): string[] {
  const stars = keys.map((key) => ({ key, label: `Named ${key}` }));
  return texts(renderToStaticMarkup(<StarClassItems x={0} y={0} stars={stars} />));
}

describe("the Add system menu's star classes", () => {
  it("lists single stars as rows", () => {
    expect(entries("sc_g", "sc_m")).toEqual(["Named sc_g", "Named sc_m"]);
  });

  it("leaves out each class of several stars, whatever its key, with no submenu per count", () => {
    expect(entries("sc_g", "sc_pair", "sc_m", "sc_trinary_1")).toEqual([
      "Named sc_g",
      "Named sc_m",
    ]);
  });
});

describe("the Binary or trinary submenu", () => {
  it("offers a random binary, a random trinary and the builder, which opens at the spot", () => {
    useMapChromeStore.setState({
      contextMenu: {
        target: { kind: "space", x: -50, y: -20 },
        x: 400,
        y: 300,
        perUnit: { x: 2, y: 2 },
      } as never,
    });
    const html = drawnBy(() => renderToStaticMarkup(<MultiStarRows x={-50} y={-20} />));
    expect(texts(html)).toEqual(["Random binary", "Random trinary", "Build one…"]);
    expect(html).toContain("context-menu-separated");

    const build = lastDrawn(
      ({ props }) => typeof props.run === "function" && props.children === "Build one…",
      "Build one…",
    ) as { run(): void };
    build.run();
    const builder = useStarBuilderStore.getState();
    expect(builder.open).toBe(true);
    expect(builder.at).toEqual({ x: -50, y: -20 });
    expect(builder.anchor).toEqual({ x: 400, y: 300 });
    expect(builder.perUnit).toEqual({ x: 2, y: 2 });
  });
});
