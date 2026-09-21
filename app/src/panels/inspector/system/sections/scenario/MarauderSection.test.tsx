import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../api/ipc");
vi.mock("../../../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../../../api/__mocks__/dialog"));
vi.mock("../../../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../../../test/zustandSnapshot"));

import type { MarauderRole } from "../../../../../generated/MarauderRole";
import { bindStores } from "../../../../../store/bindStores";
import { detailOf } from "../../../../../store/fixture";
import { useFileSessionStore } from "../../../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../../../store/galaxyStore";
import { mocked, open, overview, resetStores, sections, SYSTEM } from "../../../inspectorFixture";
import { ADD_BASES, homeIntro, NO_HOME_BESIDE } from "./MarauderSection";

bindStores();

/** The text as the static renderer escapes it. */
const escaped = (text: string) => text.replace(/'/g, "&#x27;");

/** A role's initializer: a base's names its site, `_2` unless told otherwise. */
function initializerOf(role: MarauderRole, site: 2 | 3 = 2): string {
  return "home" in role ? `marauder_${role.home}_1` : `marauder_${role.base}_${site}`;
}

/**
 * Opens a plain scenario with `SYSTEM` in `role`, and the fixture systems `others` in the roles
 * given, each with the initializer its role implies.
 */
async function openWith(
  role: MarauderRole | null,
  others: Record<number, [MarauderRole, (2 | 3)?]> = {},
): Promise<void> {
  mocked.getSystem.mockImplementation(async (id) => {
    const detail = detailOf(id);
    return {
      ...detail,
      system: {
        ...detail.system,
        marauder: role,
        initializer: role === null ? detail.system.initializer : initializerOf(role),
      },
    };
  });
  await open("scenario");
  const systems = new Map(useGalaxyStore.getState().systems);
  const put = (id: number, r: MarauderRole | null, site?: 2 | 3) =>
    systems.set(id, {
      ...systems.get(id)!,
      marauder: r,
      initializer: r === null ? "basic_init_01" : initializerOf(r, site),
    });
  put(SYSTEM, role);
  for (const [id, [r, site]] of Object.entries(others)) put(Number(id), r, site);
  useGalaxyStore.setState({ systems });
}

beforeEach(resetStores);

describe("a scenario system's marauder clan", () => {
  it("is shown for a marauder system of any scenario, after the fallen empire zone", async () => {
    await openWith({ home: 2 });
    expect(sections(overview())).toContain("Marauder clan 2");
    useFileSessionStore.setState({ painted: true });
    const html = overview();
    const titles = sections(html);
    expect(titles.indexOf("Fallen empire zone")).toBeLessThan(titles.indexOf("Marauder clan 2"));
    expect(html.indexOf('class="ins-sec-title">Marauder clan 2')).toBeLessThan(
      html.indexOf("marauder_2_1"),
    );
  });

  it("is absent for a system that is no marauder's", async () => {
    await openWith(null);
    expect(overview()).not.toContain("Marauder clan");
  });

  it("explains a home, names its two bases with links, and offers the clan select and removal", async () => {
    await openWith({ home: 1 }, { 0: [{ base: 1 }, 2], 2: [{ base: 1 }, 3], 3: [{ base: 2 }] });
    const html = overview();
    for (const line of homeIntro(1)) expect(html).toContain(escaped(line));
    expect(html).toMatch(/Raid base 2: <button[^>]*>Sol<\/button>/);
    expect(html).toMatch(/Raid base 3: <button[^>]*>Barnard<\/button>/);
    expect(html).not.toContain(ADD_BASES);
    expect(html).toContain('<option value="1" selected="">1</option>');
    expect(html).toContain('<option value="2">2</option>');
    expect(html).toContain('<option value="3">3</option>');
    expect(html).toContain(">Remove clan</button>");
  });

  it("says which base is missing and offers to add it", async () => {
    await openWith({ home: 1 }, { 0: [{ base: 1 }, 2], 5: [{ base: 1 }, 3] });
    const html = overview();
    expect(html).toMatch(/Raid base 2: <button[^>]*>Sol<\/button>/);
    expect(html).toContain("Raid base 3: missing");
    expect(html).toContain(`>${ADD_BASES}</button>`);
  });

  it("marks a clan another system holds as in use, and cannot pick it", async () => {
    await openWith({ home: 1 }, { 3: [{ home: 3 }] });
    const html = overview();
    expect(html).toContain('<option value="3" disabled="">3 · in use</option>');
    expect(html).toContain('<option value="1" selected="">1</option>');
  });

  it("names a base's home across its lane, or warns that nothing spawns without one", async () => {
    await openWith({ base: 2 }, { 0: [{ home: 2 }] });
    let html = overview();
    expect(sections(html)).toContain("Marauder clan 2");
    expect(html).toContain("Raid base of clan 2.");
    expect(html).toMatch(/Its clan home is <button[^>]*>Sol<\/button>\./);
    expect(html).not.toContain(NO_HOME_BESIDE);

    await openWith({ base: 2 }, { 5: [{ home: 2 }], 0: [{ home: 1 }] });
    html = overview();
    expect(html).toContain("Raid base of clan 2.");
    expect(html).toContain(`<div class="ins-warn">${NO_HOME_BESIDE}</div>`);
    expect(html).not.toContain("Its clan home is");
  });
});
