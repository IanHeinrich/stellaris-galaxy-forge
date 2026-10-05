import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import type { PreparePreview } from "../../generated/PreparePreview";
import { OUTCOME_LABELS } from "../../lib/prepareCopy";
import { PREPARE_ROWS, usePrepareStore } from "../../store/prepareStore";
import { resetStores } from "../../store/storeFixture";
import { PrepareLegend } from "./PrepareLegend";

const legend = () => renderToStaticMarkup(<PrepareLegend />);

function preview(beside: Partial<PreparePreview> = {}): PreparePreview {
  return {
    profile: "paint_a_galaxy",
    rows: PREPARE_ROWS.map((row) => ({ row, systems: [] })),
    changes: 3,
    kept_clear: [5],
    cut_off: [],
    new_seats: [],
    new_zones: [],
    ...beside,
  };
}

beforeEach(() => {
  resetStores();
});

describe("the Prepare legend", () => {
  it("names the new starting positions and zones with their counts while the map shows them", () => {
    usePrepareStore.setState({
      preview: preview({
        new_seats: [1, 2],
        new_zones: [{ system: 3, zone: {} as never }],
      }),
    });
    expect(legend()).toBe("");
    usePrepareStore.getState().showOutcome(true);
    const html = legend();
    expect(html).toContain(`<span>${OUTCOME_LABELS.seat}</span><span class="muted">2</span>`);
    expect(html).toContain(`<span>${OUTCOME_LABELS.zone}</span><span class="muted">1</span>`);

    usePrepareStore.getState().showOutcome(false);
    expect(legend()).toBe("");
  });

  it("shows only what there is, and nothing while Galaxy Forge draws nothing new", () => {
    usePrepareStore.getState().showOutcome(true);
    usePrepareStore.setState({ preview: preview() });
    expect(legend()).toBe("");

    usePrepareStore.setState({ preview: preview({ new_seats: [4] }) });
    const html = legend();
    expect(html).toContain(OUTCOME_LABELS.seat);
    expect(html).not.toContain(OUTCOME_LABELS.zone);
  });
});
