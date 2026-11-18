import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import { useEntityStore, viewKey } from "../../../store/entityStore";
import { entityView, fact, megastructureSummary } from "../../../store/fixture";
import { megastructureEntry, useInspectorStore } from "../../../store/inspectorStore";
import type { InspectorTab } from "../../../store/inspectorStore";
import { bindStores } from "../../../store/bindStores";
import { editResult } from "../../../store/fixture";
import { drawnBy, drawnField } from "../../../test/drawn";
import { useGameDataStore } from "../../../store/gameDataStore";
import type { RowOrigin } from "../../../generated/RowOrigin";
import { rowOrigin, structureSpawn } from "../../../test/builders";
import { mockedIpc } from "../../../test/ipc";
import { TextField } from "../../EditField";
import { details, land, open, resetStores, SYSTEM } from "../inspectorFixture";
import { MegastructureView } from "./MegastructureView";

bindStores();

const NEXUS = 6;
const GATE = 7;

/** The Science Nexus's page on `tab`, opened from its system's view. */
function render(tab: InspectorTab): string {
  const entry = megastructureEntry(NEXUS, "Science Nexus");
  useInspectorStore.setState({
    stack: [{ ref: { kind: "system", id: SYSTEM }, label: "Alpha Centauri" }, entry],
    tab,
  });
  return renderToStaticMarkup(<MegastructureView entry={entry} />);
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
  await open("save");
  await land(
    details({ megastructures: [megastructureSummary({ id: NEXUS, kind: "think_tank_3" })] }),
  );
  const view = entityView("megastructure", {
    addr: { kind: "megastructure", id: NEXUS },
    overview: [fact("Type", "Science Nexus")],
  });
  useEntityStore.setState({ views: new Map([[viewKey(view.addr, view.path), view]]) });
});

describe("a megastructure's page", () => {
  it("lists its facts, then Delete megastructure, asked of the core", () => {
    const html = render("overview");
    expect(html).toContain("Science Nexus");
    expect(html.indexOf("Type")).toBeLessThan(html.indexOf("Delete megastructure"));
    expect(mockedIpc.checkOp).toHaveBeenCalledWith({
      type: "DeleteMegastructure",
      megastructure: NEXUS,
    });
  });

  it("shows why the core refuses, and disables the action", async () => {
    const refusal = "megastructure 6 cannot be deleted: it stands in no system";
    mockedIpc.checkOp.mockResolvedValue(refusal);
    render("overview");
    await vi.advanceTimersByTimeAsync(0);
    const html = render("overview");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Delete megastructure<\/button>/);
    expect(html).toContain(refusal);
  });

  it("leaves the action off its other tabs", () => {
    expect(render("data")).not.toContain("Delete megastructure");
  });
});

describe("a megastructure at a point of its own", () => {
  it("offers its distance and angle on a save, and sends the move typed", async () => {
    resetStores();
    await open("save");
    await land(
      details({
        megastructures: [megastructureSummary({ id: GATE, kind: "gateway_final", at: [0, 250] })],
      }),
    );
    const entry = megastructureEntry(GATE, "Gateway");
    useInspectorStore.setState({ stack: [entry], tab: "overview" });
    const html = drawnBy(() => renderToStaticMarkup(<MegastructureView entry={entry} />));
    expect(html).toMatch(/<input type="number"[^>]*aria-label="Distance"[^>]*value="250"/);
    expect(html).toMatch(/<input type="number"[^>]*aria-label="Angle"[^>]*value="90"/);

    mockedIpc.applyOp.mockResolvedValue(editResult());
    const distance = drawnField(TextField, "Distance") as { onCommit(v: number): void };
    distance.onCommit(300);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "MoveMegastructure",
      megastructure: GATE,
      at: { place: "free", x: expect.closeTo(0), y: expect.closeTo(300) },
    });
  });

  it("offers none for a row tied to a body", async () => {
    resetStores();
    await open("save");
    await land(
      details({
        megastructures: [megastructureSummary({ id: GATE, kind: "think_tank_3", planet: 2 })],
      }),
    );
    const entry = megastructureEntry(GATE, "Science Nexus");
    useInspectorStore.setState({ stack: [entry], tab: "overview" });
    expect(renderToStaticMarkup(<MegastructureView entry={entry} />)).not.toContain("Distance");
  });

  /** A scenario whose system holds the ruined gateway at `origin`, and its page's markup. */
  async function scenarioRuin(origin: RowOrigin): Promise<string> {
    resetStores();
    await open("scenario");
    await land(
      details({
        megastructures: [
          megastructureSummary({
            id: GATE,
            kind: "gateway_ruined",
            at: [-100, 0],
            spawn: structureSpawn(origin),
          }),
        ],
      }),
    );
    useGameDataStore.setState({ names: new Map([["gateway_ruined", "Ruined Gateway"]]) });
    const entry = megastructureEntry(GATE, "Disabled Gateway");
    useInspectorStore.setState({ stack: [entry], tab: "overview" });
    return renderToStaticMarkup(<MegastructureView entry={entry} />);
  }

  it("serves a scenario's own ruin from its system's details, with its position and Delete", async () => {
    const html = await scenarioRuin(rowOrigin(GATE));
    expect(html).toContain("Megastructure in");
    expect(html).toContain("Ruined Gateway");
    expect(html).not.toContain("gateway_ruined");
    expect(html).toMatch(/aria-label="Distance"[^>]*value="100"/);
    expect(html.indexOf("Type")).toBeLessThan(html.indexOf("Delete megastructure"));
    expect(mockedIpc.checkOp).toHaveBeenCalledWith({
      type: "RemoveMegastructure",
      megastructure: GATE,
    });
    expect(mockedIpc.getEntity).not.toHaveBeenCalled();
  });

  it("offers no Delete for a ruin the file writes in a way the editor doesn't edit", async () => {
    const html = await scenarioRuin(rowOrigin(GATE, false));
    expect(html).toContain("Ruined Gateway");
    expect(html).not.toContain("Delete megastructure");
  });
});
