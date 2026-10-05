import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { PREPARE_COPY } from "../../lib/prepareCopy";
import { PREPARE_ROWS, usePrepareStore } from "../../store/prepareStore";
import { resetStores } from "../../store/storeFixture";
import { PrepareCaption } from "./PrepareCaption";

const caption = () => renderToStaticMarkup(<PrepareCaption />);
const enclaves = PREPARE_COPY.plain.enclaves;

beforeEach(() => {
  resetStores();
  usePrepareStore.setState({
    preview: {
      profile: "plain",
      rows: PREPARE_ROWS.map((row) => ({ row, systems: row === "enclaves" ? [3, 4, 5] : [] })),
      changes: 0,
      kept_clear: [],
      cut_off: [],
    },
  });
});

describe("the Prepare caption", () => {
  it("names the hovered row's ringed systems and what leaving a kept row out does", () => {
    expect(caption()).toBe("");
    usePrepareStore.getState().hover("enclaves");
    const html = caption();
    expect(html).toContain("3 systems ringed: Enclaves");
    expect(html).toContain(enclaves.ifLeftOut);

    usePrepareStore.getState().setChoice("enclaves", "plain");
    expect(caption()).not.toContain(enclaves.ifLeftOut);
  });

  it("goes with the rings: nothing for a row with no systems, or once the pointer leaves", () => {
    usePrepareStore.getState().hover("guardians");
    expect(caption()).toBe("");
    usePrepareStore.getState().hover("enclaves");
    usePrepareStore.getState().hover(null);
    expect(caption()).toBe("");
  });
});
