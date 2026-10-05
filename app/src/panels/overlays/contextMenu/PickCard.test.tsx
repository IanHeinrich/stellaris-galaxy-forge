import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import type { PickSummary } from "../../../generated/PickSummary";
import type { SpecialLayout } from "../../../generated/SpecialLayout";
import { shown } from "../../../test/elements";
import { PickCardBody } from "./PickCard";
import { SpecialRows } from "./SpecialItems";

describe("the Special menu and the cards", () => {
  const summary = (extra: Partial<PickSummary> = {}): PickSummary => ({
    star_classes: [{ key: "sc_m", name: "Class M Star" }],
    star_description: null,
    planets: { min: 2, max: 5 },
    max_moons: 0,
    moons: "never",
    belts: { min: 0, max: 0 },
    belt_kinds: [],
    asteroids: { min: 0, max: 0 },
    named_bodies: [],
    notable_classes: [],
    modifiers: [],
    rings: "never",
    dlc: null,
    max_instances: null,
    in_galaxy: null,
    ...extra,
  });
  const layout = (key: string, label: string, extra: Partial<SpecialLayout> = {}) => ({
    layout: { key, label, unique: false, capped: false, in_galaxy: 0, dlc: null, ...extra },
    summary: summary(extra.capped ? { max_instances: 1 } : {}),
  });

  it("groups unique systems before the other special systems, each by label, and marks each row", () => {
    const html = renderToStaticMarkup(
      <SpecialRows
        x={0}
        y={0}
        picks={[
          layout("wooden", "Arboreal World", { dlc: { name: "Cosmic Storms", met: false } }),
          layout("zevox", "Zevox", { unique: true, capped: true, in_galaxy: 1 }),
          layout("kira", "Kira", { unique: true, capped: true }),
          layout("trappist", "Trappist", { capped: true }),
          layout("metal", "Metal Planet", { dlc: { name: "Cosmic Storms", met: true } }),
        ]}
      />,
    );
    const order = [
      ...html.matchAll(/>(Unique systems|Other special systems)<|<span>([^<]+)<\/span>/g),
    ].map((m) => m[1] ?? m[2]);
    expect(order).toEqual([
      "Unique systems",
      "Kira",
      "Zevox",
      "Other special systems",
      "Arboreal World",
      "Metal Planet",
      "Trappist",
    ]);
    expect(html.match(/aria-label="Already in this galaxy"/g)).toHaveLength(1);
    expect(shown(html).match(/\bDLC\b/g)).toHaveLength(1);
    expect(html).toContain("Needs Cosmic Storms, which this save doesn&#x27;t have");
    expect(html).not.toContain("disabled");
  });

  it("says what a pick can produce and leaves out what it has nothing for", () => {
    const html = renderToStaticMarkup(<PickCardBody title="Random" summary={summary()} />);
    expect(html).toContain("Class M Star");
    expect(html).toContain("2–5");
    expect(html).not.toContain("Belts");
    expect(html).not.toContain("Unique");
  });

  it("says a unique layout is already in the galaxy, in the warning colour", () => {
    const html = renderToStaticMarkup(
      <PickCardBody
        title="Wenkwort"
        summary={summary({
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
        summary={summary({
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
});
