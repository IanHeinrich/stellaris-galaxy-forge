import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import type { WormholeSummary } from "../../../generated/WormholeSummary";
import { GEOMETRY_REASONS } from "../../../lib/details/orbitIntent";
import { bindStores } from "../../../store/bindStores";
import { editResult } from "../../../store/fixture";
import { useInspectorStore, wormholeEntry } from "../../../store/inspectorStore";
import { drawnBy, drawnField } from "../../../test/drawn";
import { mockedIpc } from "../../../test/ipc";
import { TextField } from "../../EditField";
import { details, land, open, resetStores, SYSTEM } from "../inspectorFixture";
import { WormholeView } from "./WormholeView";

bindStores();

const WORMHOLE: WormholeSummary = {
  id: 30,
  bypass: 31,
  kind: "wormhole",
  partner: SYSTEM,
  x: 0,
  y: 200,
};
const TUNNEL: WormholeSummary = {
  id: 32,
  bypass: 33,
  kind: "shroud_tunnel",
  partner: null,
  x: -100,
  y: 0,
};

/** Wormhole `id`'s page on its Overview, opened from its system's view. */
function render(id: number): string {
  const entry = wormholeEntry(SYSTEM, id, "Wormhole");
  useInspectorStore.setState({
    stack: [{ ref: { kind: "system", id: SYSTEM }, label: "Alpha Centauri" }, entry],
    tab: "overview",
  });
  return renderToStaticMarkup(<WormholeView entry={entry} />);
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

describe("a wormhole's page", () => {
  it("offers a natural wormhole's distance and angle to edit, and sends the move typed", async () => {
    await open("save");
    await land(details({ wormholes: [WORMHOLE, TUNNEL] }));

    const html = drawnBy(() => render(WORMHOLE.id));
    expect(html).toMatch(/<input type="number"[^>]*aria-label="Distance"[^>]*value="200"/);
    expect(html).toMatch(/<input type="number"[^>]*aria-label="Angle"[^>]*value="90"/);
    expect(html).toContain("Leads to");
    expect(html).toContain("#31");

    mockedIpc.applyOp.mockResolvedValue(editResult());
    const distance = drawnField(TextField, "Distance") as { onCommit(v: number): void };
    distance.onCommit(300);
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenCalledWith({
        type: "MoveWormhole",
        wormhole: WORMHOLE.id,
        radius: 300,
        angle: 90,
      }),
    );
  });

  it("shows a shroud tunnel's place as text, saying why it cannot move", async () => {
    await open("save");
    await land(details({ wormholes: [WORMHOLE, TUNNEL] }));

    const html = render(TUNNEL.id);
    expect(html).not.toContain('aria-label="Distance"');
    expect(html).toContain('<span class="k">Distance</span><span>100</span>');
    expect(html).toContain(GEOMETRY_REASONS.lockedWormhole);
    expect(html).not.toContain("Leads to");
  });
});
