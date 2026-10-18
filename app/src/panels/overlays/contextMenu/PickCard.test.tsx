import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import { useGameDataStore } from "../../../store/gameDataStore";
import { resetStores } from "../../../store/storeFixture";
import { pickSummary, starClassView } from "../../../test/builders";
import { PickCardBody } from "./PickCard";

beforeEach(resetStores);

describe("the cards", () => {
  it("names a multiple star by its stars, as its row is, and a single star by its own name", () => {
    useGameDataStore.setState({
      starClasses: new Map(
        [
          starClassView("sc_binary_2", "pc_b_star", "pc_neutron_star"),
          starClassView("sc_m", "pc_m_star"),
        ].map((c) => [c.key, c]),
      ),
      names: new Map([
        ["pc_b_star", "Class B Star"],
        ["pc_neutron_star", "Neutron Star"],
      ]),
    });
    const html = renderToStaticMarkup(
      <PickCardBody
        title="Random"
        summary={pickSummary({
          star_classes: [
            { key: "sc_binary_2", name: "Binary Stars" },
            { key: "sc_m", name: "Class M Star" },
          ],
        })}
      />,
    );
    expect(html).toContain("Class B Star + Neutron Star or Class M Star");
    expect(html).not.toContain("Binary Stars");
  });

  it("says what a pick can produce and leaves out what it has nothing for", () => {
    const html = renderToStaticMarkup(<PickCardBody title="Random" summary={pickSummary()} />);
    expect(html).toContain("Class M Star");
    expect(html).toContain("2–5");
    expect(html).not.toContain("Belts");
    expect(html).not.toContain("Unique");
  });

  it("says a unique layout is already in the galaxy, in the warning colour", () => {
    const html = renderToStaticMarkup(
      <PickCardBody
        title="Wenkwort"
        summary={pickSummary({
          max_instances: 1,
          in_galaxy: 1,
          belts: { min: 1, max: 1 },
          belt_kinds: [{ key: "rocky_asteroid_belt", name: "Rocky Asteroid Belt", every: true }],
          modifiers: [{ key: "pm_wenkwort_gardens", name: "Wenkwort Gardens", every: true }],
        })}
      />,
    );
    expect(html).toContain("1 (Rocky Asteroid Belt)");
    expect(html).toContain("Wenkwort Gardens");
    expect(html).toContain(
      '<div class="pick-card-note warn">One per galaxy. Already in this galaxy (1). You can still place it.</div>',
    );
  });

  it("says a unique layout is not here yet, and when the save lacks its DLC", () => {
    const html = renderToStaticMarkup(
      <PickCardBody
        title="Arboreal World"
        summary={pickSummary({
          max_instances: 1,
          in_galaxy: 0,
          dlc: { name: "Cosmic Storms", met: false },
        })}
      />,
    );
    expect(html).toContain("One per galaxy. Not in this galaxy yet.");
    expect(html).toContain(
      "This save doesn&#x27;t have Cosmic Storms, so its events won&#x27;t run.",
    );
  });

  it("shows what a special layout comes with and without, and the event chain warning", () => {
    const html = renderToStaticMarkup(
      <PickCardBody
        title="Tiyun Ort"
        summary={pickSummary({
          comes_with: [{ kind: "dig_site", key: "site_graveyard", name: "Tiyanki Graveyard" }],
          comes_without: ["fleets", "ambient_objects"],
          story_kept_by_existing: true,
        })}
      />,
    );
    expect(html).toContain("Comes with");
    expect(html).toContain("Tiyanki Graveyard");
    expect(html).toContain("fleets and guardians, debris, wrecks and storms");
    expect(html).toContain(
      '<div class="pick-card-note warn">Tiyun Ort is already in this galaxy, so its event chain stays with that one.</div>',
    );
  });
});
