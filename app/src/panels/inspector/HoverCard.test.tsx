import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { useDetailsStore } from "../../store/detailsStore";
import { resetStores } from "../../store/storeFixture";
import { HoverCard } from "./HoverCard";

beforeEach(() => {
  resetStores();
  useDetailsStore.setState({ resourceIcons: new Map([["energy", "GFX_energy"]]) });
});

describe("a hover card", () => {
  it("shows a description with its colours and resource icons", () => {
    const html = renderToStaticMarkup(
      <HoverCard
        id="card"
        rowId="row"
        item={{
          label: "Energy Vein",
          effects: [],
          description: "Gives §Y£energy£ 5§! each month.",
        }}
      />,
    );
    expect(html).toContain(
      '<span class="dp-card-text">Gives <span class="gt-Y"><span class="gi gt-icon">',
    );
    expect(html).toContain(" 5</span> each month.</span>");
    expect(html).not.toMatch(/[£§]/);
  });

  it("still says when a card has no description", () => {
    const html = renderToStaticMarkup(
      <HoverCard id="card" rowId="row" item={{ label: "Vein", effects: [], description: null }} />,
    );
    expect(html).toContain('<span class="muted">No description</span>');
  });
});
