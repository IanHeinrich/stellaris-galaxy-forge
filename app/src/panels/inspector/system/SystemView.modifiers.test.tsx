import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import type { EffectModifier } from "../../../generated/EffectModifier";
import { documentCapabilities } from "../../../lib/capabilities";
import { NO_SYSTEM_MODIFIERS, ORIGIN_MARK_TEXT } from "../../../lib/details/placedRows";
import { bindStores } from "../../../store/bindStores";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { modifierView } from "../../../store/fixtures/planet";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { systemSpawn } from "../../../test/spawn";
import { details, land, open, overview, resetStores, sections } from "../inspectorFixture";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

const ADD = "+ Add modifier…";

function modifier(key: string, over: Partial<EffectModifier> = {}): EffectModifier {
  return { modifier: key, days: -1, editable: true, ...over };
}

function systemModifiersTo(on: boolean): void {
  const now = documentCapabilities(useFileSessionStore.getState());
  useFileSessionStore.setState({ capabilities: { ...now, system_modifiers: on } });
}

/** The markup of the row named `name`, up to the next modifier row. */
function rowOf(html: string, name: string): string {
  const start = html.indexOf(`>${name}<`);
  expect(start, `a row for ${name}`).toBeGreaterThan(-1);
  const end = html.indexOf(`class="pl-mod"`, start);
  return end === -1 ? html.slice(start) : html.slice(start, end);
}

describe("a scenario system's Modifiers section", () => {
  it("shows with none and its Add modifier where the document adds them, and not where it doesn't", async () => {
    await open("scenario");
    await land(details({ spawn: systemSpawn() }));
    let html = overview();
    expect(sections(html)).toContain("Modifiers · 0");
    expect(html).toContain(`>${NO_SYSTEM_MODIFIERS}<`);
    expect(html).toContain(ADD);

    systemModifiersTo(false);
    html = overview();
    expect(sections(html)).not.toContain("Modifiers · 0");
    expect(html).not.toContain(ADD);
  });

  it("is not on a save's system", async () => {
    await open("save");
    await land(details());
    expect(sections(overview()).some((s) => s.startsWith("Modifiers"))).toBe(false);
  });

  it("names each modifier from the game data, and offers removal only for one the editor wrote", async () => {
    usePlanetDataStore.setState({
      modifiers: new Map([
        ["queen_scorn_storm", modifierView("queen_scorn_storm", { name: "Veil of Scorn" })],
        ["vluur_storm", modifierView("vluur_storm", { name: "Vluur Storm" })],
      ]),
    });
    await open("scenario");
    await land(
      details({
        spawn: systemSpawn({
          modifiers: [
            modifier("queen_scorn_storm"),
            modifier("vluur_storm", { days: 30, editable: false }),
          ],
        }),
      }),
    );
    const html = overview();
    expect(sections(html)).toContain("Modifiers · 2");
    expect(html).not.toContain(`>${NO_SYSTEM_MODIFIERS}<`);

    const own = rowOf(html, "Veil of Scorn");
    expect(own).toContain('aria-label="Remove Veil of Scorn"');
    expect(own).toContain("permanent");
    expect(own).not.toContain(ORIGIN_MARK_TEXT.file);

    const timed = rowOf(html, "Vluur Storm");
    expect(timed).not.toContain("Remove Vluur Storm");
    expect(timed).toContain(ORIGIN_MARK_TEXT.file);
    expect(timed).toContain("lasts 30 days");
  });
});
