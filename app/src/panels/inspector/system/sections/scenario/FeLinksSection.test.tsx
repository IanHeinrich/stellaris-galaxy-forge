import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../api/ipc");
vi.mock("../../../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../../../api/__mocks__/dialog"));
vi.mock("../../../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../../../test/zustandSnapshot"));

import type { FeLinkFlags } from "../../../../../generated/FeLinkFlags";
import { newFeZone } from "../../../../../lib/feZone";
import { bindStores } from "../../../../../store/bindStores";
import { detailOf } from "../../../../../store/fixture";
import { useFileSessionStore } from "../../../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../../../store/galaxyStore";
import { open, overview, resetStores, sections, SYSTEM } from "../../../inspectorFixture";
import { FE_LINKS_INTRO } from "./FeLinksSection";
import { mockedIpc } from "../../../../../test/ipc";

bindStores();

const TAKES_2: FeLinkFlags = { custom: true, id: 2, to: [] };
const TAKES_4: FeLinkFlags = { custom: true, id: 4, to: [] };

/**
 * Opens the scenario under the Paint a Galaxy layer with `SYSTEM` linking to `to`, Sirius
 * anchoring a zone under id 2 and Deneb one under id 4.
 */
async function openLinking(to: number[], anchorsItself = false): Promise<void> {
  const zone = anchorsItself ? newFeZone("n") : null;
  const fe_link: FeLinkFlags = { custom: false, id: null, to };
  mockedIpc.getSystem.mockImplementation(async (id) => {
    const detail = detailOf(id);
    return { ...detail, system: { ...detail.system, fe_zone: zone, fe_link } };
  });
  await open("scenario");
  useFileSessionStore.setState({ painted: true });
  const systems = new Map(useGalaxyStore.getState().systems);
  systems.set(SYSTEM, { ...systems.get(SYSTEM)!, fe_zone: zone, fe_link });
  systems.set(3, { ...systems.get(3)!, fe_zone: newFeZone("s"), fe_link: TAKES_2 });
  systems.set(5, { ...systems.get(5)!, fe_zone: newFeZone("n"), fe_link: TAKES_4 });
  useGalaxyStore.setState({ systems });
}

beforeEach(resetStores);

describe("a scenario system's fallen empire links", () => {
  it("names each zone's system with a link and an unlink, after the fallen empire zone", async () => {
    await openLinking([2, 4]);
    const html = overview();
    expect(sections(html)).toContain("Fallen empire links");
    expect(html.indexOf("Fallen empire zone")).toBeLessThan(html.indexOf("Fallen empire links"));
    expect(html.indexOf("Fallen empire links")).toBeLessThan(html.indexOf("basic_init_01"));
    expect(html).toMatch(
      /Linked to the zone of <button[^>]*>Sirius<\/button><button[^>]*aria-label="Unlink from Sirius&#x27;s zone"[^>]*>×<\/button>/,
    );
    expect(html).toMatch(/Linked to the zone of <button[^>]*>Deneb<\/button>/);
    expect(html.indexOf(">Sirius</button>")).toBeLessThan(html.indexOf(">Deneb</button>"));
    expect(html).toContain(FE_LINKS_INTRO);
  });

  it("is absent for a system linking to nothing, to an id no zone takes, or anchoring a zone itself", async () => {
    await openLinking([]);
    expect(sections(overview())).not.toContain("Fallen empire links");
    await openLinking([7]);
    expect(sections(overview())).not.toContain("Fallen empire links");
    await openLinking([2], true);
    expect(sections(overview())).not.toContain("Fallen empire links");
  });

  it("is absent without the Paint a Galaxy layer", async () => {
    await openLinking([2]);
    useFileSessionStore.setState({ painted: false });
    expect(sections(overview())).not.toContain("Fallen empire links");
  });
});
