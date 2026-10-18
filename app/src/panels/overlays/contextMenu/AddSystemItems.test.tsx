import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import { useGameDataStore } from "../../../store/gameDataStore";
import { resetStores } from "../../../store/storeFixture";
import { starClassView } from "../../../test/builders";
import { StarClassItems } from "./AddSystemItems";

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

/** The menu's entries for `keys` offered, each as its text. */
function entries(...keys: string[]): string[] {
  const stars = keys.map((key) => ({ key, label: `Named ${key}` }));
  const html = renderToStaticMarkup(<StarClassItems x={0} y={0} stars={stars} />);
  return [...html.matchAll(/<button type="button" role="menuitem"[^>]*>(.*?)<\/button>/g)].map(
    (m) => m[1].replace(/<[^>]*>/g, ""),
  );
}

describe("the Add system menu's star classes", () => {
  it("lists single stars as rows, with no submenu while no multiple star is offered", () => {
    expect(entries("sc_g", "sc_m")).toEqual(["Named sc_g", "Named sc_m"]);
  });

  it("puts each class of several stars in the submenu for its star count, whatever its key", () => {
    expect(entries("sc_g", "sc_pair", "sc_m", "sc_trinary_1")).toEqual([
      "Named sc_g",
      "Named sc_m",
      "Binary stars▸",
      "Trinary stars▸",
    ]);
    expect(entries("sc_g", "sc_pair")).toEqual(["Named sc_g", "Binary stars▸"]);
  });
});
