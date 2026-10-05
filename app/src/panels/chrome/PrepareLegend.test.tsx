import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { OUTCOME_LABELS } from "../../lib/prepareCopy";
import { PREPARE_ROWS, usePrepareStore } from "../../store/prepareStore";
import { resetStores } from "../../store/storeFixture";
import { PrepareLegend } from "./PrepareLegend";

const legend = () => renderToStaticMarkup(<PrepareLegend />);

beforeEach(() => {
  resetStores();
  usePrepareStore.setState({
    choices: { ...usePrepareStore.getState().choices, enclaves: "game_decides" },
    preview: {
      profile: "plain",
      rows: PREPARE_ROWS.map((row) => ({ row, systems: row === "enclaves" ? [3, 4, 5] : [] })),
      changes: 3,
      kept_clear: [5],
      cut_off: [],
      new_seats: [],
      new_zones: [],
    },
  });
});

describe("the Prepare legend", () => {
  it("names each colour with how many systems have it while the map shows the outcome", () => {
    expect(legend()).toBe("");
    usePrepareStore.getState().showOutcome(true);
    const html = legend();
    expect(html).toContain(`<span>${OUTCOME_LABELS.ordinary}</span><span class="muted">1</span>`);
    expect(html).toContain(`<span>${OUTCOME_LABELS.rolled}</span><span class="muted">2</span>`);
    expect(html).toContain(`<span>${OUTCOME_LABELS.seat}</span><span class="muted">0</span>`);
    expect(html).not.toContain(OUTCOME_LABELS.zone);
  });

  it("names new zones on a Paint a Galaxy map, and goes once the map stops showing the outcome", () => {
    usePrepareStore.getState().showOutcome(true);
    const preview = usePrepareStore.getState().preview!;
    usePrepareStore.setState({ preview: { ...preview, profile: "paint_a_galaxy" } });
    expect(legend()).toContain(OUTCOME_LABELS.zone);

    usePrepareStore.getState().showOutcome(false);
    expect(legend()).toBe("");
  });
});
