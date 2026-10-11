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
import { mockedIpc } from "../../../test/ipc";
import { details, land, open, resetStores, SYSTEM } from "../inspectorFixture";
import { MegastructureView } from "./MegastructureView";

const NEXUS = 6;

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
    const refusal = "a fleet is building on megastructure 6";
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
