import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../api/ipc");
vi.mock("../../../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../../../api/__mocks__/dialog"));
vi.mock("../../../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../../../test/zustandSnapshot"));

import type { FeLinkFlags } from "../../../../../generated/FeLinkFlags";
import type { FeZone } from "../../../../../generated/FeZone";
import { newFeZone } from "../../../../../lib/feZone";
import { bindStores } from "../../../../../store/bindStores";
import { detailOf, SYSTEMS } from "../../../../../store/fixture";
import { useFileSessionStore } from "../../../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../../../store/galaxyStore";
import { useIssuesStore } from "../../../../../store/issuesStore";
import { open, overview, resetStores, sections, SYSTEM } from "../../../inspectorFixture";
import {
  ADD_ZONE_HINT,
  AUTOMATIC_NOTE,
  FALLBACK_HINT,
  FALLBACK_LABEL,
  FE_ZONE_INTRO,
  KIND_HINT,
  LINK_HINT,
  NEAREST_NOTE,
  NONE_LINKED,
} from "./FeZoneSection";
import { appIssue } from "../../../../../test/builders";
import { escaped } from "../../../../../test/elements";
import { mockedIpc } from "../../../../../test/ipc";

bindStores();

/** The text as the static renderer escapes it. */
const NO_LINKS: FeLinkFlags = { custom: false, id: null, to: [] };

/**
 * Opens the scenario under the Paint a Galaxy layer, with `SYSTEM` anchoring `zone` and
 * carrying `fe_link`, and the fixture systems `linked` linking to id 1.
 */
async function openWith(
  zone: FeZone | null,
  fe_link: FeLinkFlags = NO_LINKS,
  linked: number[] = [],
): Promise<void> {
  mockedIpc.getSystem.mockImplementation(async (id) => {
    const detail = detailOf(id);
    return { ...detail, system: { ...detail.system, fe_zone: zone, fe_link } };
  });
  await open("scenario");
  useFileSessionStore.setState({ painted: true });
  const systems = new Map(useGalaxyStore.getState().systems);
  const anchor = systems.get(SYSTEM)!;
  systems.set(SYSTEM, { ...anchor, fe_zone: zone, fe_link });
  for (const id of linked) {
    systems.set(id, { ...systems.get(id)!, fe_link: { ...NO_LINKS, to: [1] } });
  }
  useGalaxyStore.setState({ systems });
}

beforeEach(resetStores);

describe("a scenario system's fallen empire zone", () => {
  it("is offered only under the Paint a Galaxy layer, after the spawn point", async () => {
    await open("scenario");
    expect(sections(overview())).not.toContain("Fallen empire zone");

    useFileSessionStore.setState({ painted: true });
    const html = overview();
    expect(sections(html)).toContain("Fallen empire zone");
    expect(html.indexOf("Spawn point")).toBeLessThan(html.indexOf("Fallen empire zone"));
    expect(html.indexOf("Fallen empire zone")).toBeLessThan(html.indexOf("basic_init_01"));
    for (const line of FE_ZONE_INTRO) expect(html).toContain(escaped(line));
  });

  it("says None and offers to add a zone where there is room", async () => {
    await openWith(null);
    const html = overview();
    expect(html).toContain(">None<");
    const button = html.match(/<button[^>]*>Add zone<\/button>/)![0];
    expect(button).not.toContain("disabled=");
    expect(html).toContain(escaped(ADD_ZONE_HINT));
  });

  it("refuses to add a zone where every ring at distance 40 would cover a system, and says why", async () => {
    await openWith(null);
    const anchor = SYSTEMS[SYSTEM];
    const systems = new Map(useGalaxyStore.getState().systems);
    // A system on every compass point at 40, so no ring is clear.
    [0, 45, 90, 135, 180, 225, 270, 315].forEach((deg, i) => {
      const a = (deg * Math.PI) / 180;
      const s = {
        ...SYSTEMS[0],
        id: 100 + i,
        x: anchor.x + 40 * Math.cos(a),
        y: anchor.y + 40 * Math.sin(a),
      };
      systems.set(s.id, s);
    });
    useGalaxyStore.setState({ systems });
    const button = overview().match(/<button[^>]*>Add zone<\/button>/)![0];
    expect(button).toContain("disabled=");
    expect(button).toContain("No clear space for a ring at distance 40");
  });

  it("shows the zone's type, direction, distance and fallback, each with its hint", async () => {
    await openWith({ ...newFeZone("se", 60), kind: "materialist", fallback: true });
    const html = overview();
    expect(html).toContain('<option value="materialist" selected="">Materialist</option>');
    expect(
      html.match(
        /<option value="(random|materialist|spiritualist|xenophobe|xenophile|machine|hive)"/g,
      ),
    ).toHaveLength(7);
    expect(html).toContain('<option value="se" selected="">South-east</option>');
    expect(html).toContain('<option value="60" selected="">60</option>');
    expect(html.match(/<option value="\d+"/g)).toHaveLength(18);
    expect(html).toContain(KIND_HINT);
    expect(html).toContain(
      "Where the ring sits, measured from Alpha Centauri. The mod can only place a fallen " +
        "empire at these eight directions and distances.",
    );
    expect(html).toContain(FALLBACK_LABEL);
    expect(html.match(/<input type="checkbox"[^>]*>/g)!.pop()).toContain("checked=");
    expect(html).toContain(FALLBACK_HINT);
    expect(html).not.toContain(AUTOMATIC_NOTE);
    expect(html).toContain(">Remove zone</button>");
    expect(html).not.toContain(">None<");
  });

  it("says the mod links the zone to its nearest systems, and how to link one by hand", async () => {
    await openWith(newFeZone("n"));
    const html = overview();
    expect(html).toContain("Connections");
    expect(html).toContain(NEAREST_NOTE);
    expect(html).toContain(LINK_HINT);
    expect(html).not.toContain("Use nearest instead");
  });

  it("lists the linked systems with a link and an unlink each, and offers the mod's own rule", async () => {
    await openWith(newFeZone("n"), { custom: true, id: 1, to: [] }, [3, 0]);
    const html = overview();
    expect(html).not.toContain(NEAREST_NOTE);
    expect(html).toMatch(
      /<button[^>]*>Sol<\/button><button[^>]*aria-label="Unlink Sol"[^>]*>×<\/button>/,
    );
    expect(html).toMatch(/<button[^>]*>Sirius<\/button><button[^>]*aria-label="Unlink Sirius"/);
    expect(html.indexOf(">Sol</button>")).toBeLessThan(html.indexOf(">Sirius</button>"));
    expect(html).toContain(">Use nearest instead</button>");
    expect(html).not.toContain(NONE_LINKED);
  });

  it("says when a zone takes custom connections and nothing links to it", async () => {
    await openWith(newFeZone("n"), { custom: true, id: 1, to: [] });
    const html = overview();
    expect(html).toContain(NONE_LINKED);
    expect(html).toContain(">Use nearest instead</button>");
  });

  it("says when the zone is the mod's own, and that a change takes it over", async () => {
    await openWith({ ...newFeZone("n"), preferred: false });
    expect(overview()).toContain(AUTOMATIC_NOTE);
  });

  it("carries the zone's own issues, an overlap from either end", async () => {
    await openWith(newFeZone("se", 60));
    useIssuesStore.setState({
      issues: [
        appIssue({
          severity: "warning",
          code: "fe_zone_overlap",
          message:
            "Fallen empire zones from Sol and Alpha Centauri overlap: the mod cannot fill both.",
          systems: [0, 1],
        }),
        appIssue({
          severity: "warning",
          code: "fe_zone_blocked",
          message: "Fallen empire zone from Sol is blocked by Barnard's Star.",
          systems: [0, 2],
        }),
        appIssue({
          severity: "warning",
          code: "fe_link_isolated",
          message: "Alpha Centauri takes custom connections but no system links to it.",
          systems: [1],
        }),
        appIssue({
          severity: "info",
          code: "fe_link_far",
          message: "Deneb is 140 from the fallen empire zone it links to.",
          systems: [5, 1],
        }),
      ],
    });
    const html = overview();
    expect(html).toContain("Fallen empire zones from Sol and Alpha Centauri overlap");
    expect(html).not.toContain("is blocked by");
    expect(html).toContain("takes custom connections but no system links to it");
    expect(html).not.toContain("is 140 from");
  });
});
