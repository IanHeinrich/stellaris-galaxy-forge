import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { elements } from "../../test/elements";
import { stubPrefs } from "../../test/prefs";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { useFileSessionStore } from "../../store/fileSessionStore";
import { OPEN_RESULT, exportReport } from "../../store/fixture";
import { useGalaxyStore } from "../../store/galaxyStore";
import { usePaintModStore } from "../../store/paintModStore";
import { ExportDialog, ExportForm, ExportReportRows } from "./ExportDialog";
import { PaintChoice } from "./PaintChoice";
import {
  countsSummary,
  droppedSummary,
  fallenEmpiresSummary,
  homeInitializerLines,
  omittedLines,
  seatsSummary,
} from "./exportReport";

const FULL = exportReport({
  seats: 17,
  home_initializers: [
    { system: 311, initializer: "shattered_ring_start", replaced: false },
    { system: 12, initializer: "void_dwellers_start", replaced: false },
  ],
  dropped: { wormhole_pairs: 6, gateways: 0, lgates: 1 },
  by_category: [
    { category: "home", systems: 17 },
    { category: "fallen_empire", systems: 28 },
    { category: "l_cluster", systems: 9 },
    { category: "generic", systems: 737 },
  ],
  sources: [
    { source: "dlc021_distant_stars", systems: 9 },
    { source: "my_mod", systems: 2 },
  ],
});

/** The sample save converted for the mod: three fallen empires, the player at Sol, the L-Cluster left out. */
const PAINTED = exportReport({
  fallen_empires: [
    {
      name: "Ancient Caretakers",
      kind: "materialist",
      systems_left_out: 5,
      links: 3,
      anchor: 792,
      exact: true,
    },
    {
      name: "Holy Guardians",
      kind: "spiritualist",
      systems_left_out: 13,
      links: 1,
      anchor: 793,
      exact: true,
    },
    {
      name: "Custodian Matrix",
      kind: "machine",
      systems_left_out: 11,
      links: 0,
      anchor: 791,
      exact: true,
    },
  ],
  player_seat: 217,
  player_seat_kind: "sol",
  omitted: [{ category: "l_cluster", systems: 9 }],
  setup_from_save: true,
  home_initializers: [
    { system: 311, initializer: "shattered_ring_start", replaced: true },
    { system: 12, initializer: "void_dwellers_start", replaced: false },
  ],
});

const id = (system: number) => `system ${system}`;

const row = (label: string, value: string) => `<dt>${label}</dt><dd>${value}</dd>`;

function button(tree: ReactNode, text: string): ReactElement<{ onClick: () => void }> {
  const found = elements(tree).find(
    (el): el is ReactElement<{ onClick: () => void }> =>
      el.type === "button" && renderToStaticMarkup(el).includes(text),
  );
  expect(found).toBeDefined();
  return found!;
}

function form(tree: ReactNode): ReactElement<{ onSubmit: (e: unknown) => void }> {
  const found = elements(tree).find(
    (el): el is ReactElement<{ onSubmit: (e: unknown) => void }> => el.type === "form",
  );
  expect(found).toBeDefined();
  return found!;
}

const stored = new Map<string, string>();

beforeEach(() => {
  stubPrefs(stored);
  useGalaxyStore.getState().clear();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  usePaintModStore.setState({ ...usePaintModStore.getInitialState(), paintChoice: false });
});

describe("the report", () => {
  it("lists the seats, the systems by category, and everything the export left out or needs", () => {
    const html = renderToStaticMarkup(<ExportReportRows report={FULL} />);
    expect(html).toContain(row("Seats", "17 seats."));
    expect(html).toContain(
      row("Systems", "Home 17 · Fallen empire 28 · L-Cluster 9 · Generic 737"),
    );
    expect(html).toContain(row("Not carried over", "6 wormhole pairs, 1 L-Gate"));
    expect(html).toContain(row("Needs", "dlc021_distant_stars, my_mod"));
    expect(html).toContain(
      row(
        "Home initializers to review",
        "shattered_ring_start (system 311), void_dwellers_start (system 12)",
      ),
    );
  });

  it("names a home system the galaxy holds, and falls back to its id otherwise", () => {
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    const report = exportReport({
      home_initializers: [
        { system: 2, initializer: "shattered_ring_start", replaced: false },
        { system: 311, initializer: "void_dwellers_start", replaced: false },
      ],
    });
    expect(renderToStaticMarkup(<ExportReportRows report={report} />)).toContain(
      row(
        "Home initializers to review",
        "shattered_ring_start (Barnard), void_dwellers_start (system 311)",
      ),
    );
  });

  it("leaves out the rows with nothing to say", () => {
    const html = renderToStaticMarkup(<ExportReportRows report={exportReport()} />);
    expect(html).toContain(row("Seats", "17 seats."));
    expect(html).toContain(row("Systems", "Home 17 · Generic 774"));
    expect(html).not.toContain("Fallen empires");
    expect(html).not.toContain("Left out");
    expect(html).not.toContain("Counts");
    expect(html).not.toContain("Not carried over");
    expect(html).not.toContain("Needs");
    expect(html).not.toContain("Home initializers to review");
    expect(html).not.toContain("Home initializers replaced");
  });

  it("says what a conversion for the mod did with the seats, the fallen empires and the rest", () => {
    const html = renderToStaticMarkup(<ExportReportRows report={PAINTED} />);
    expect(html).toContain(
      row(
        "Seats",
        "17 seats. Your capital, system 217, is the Sol seat: only the United Nations of Earth can start there, and it will.",
      ),
    );
    expect(html).toContain(
      row(
        "Fallen empires",
        "3 fallen empire zones at the old capitals: Materialist, Spiritualist, Machine. " +
          "29 systems left out for the mod to rebuild. 3 anchor systems added. " +
          "Ancient Caretakers linked to 3 systems. Holy Guardians linked to 1 system.",
      ),
    );
    expect(html).toContain(row("Left out", "9 L-Cluster systems left out: the game adds its own."));
    expect(html).toContain(row("Counts", "Counts from the save&#x27;s setup."));
    expect(html).toContain(row("Home initializers to review", "void_dwellers_start (system 12)"));
    expect(html).toContain(
      row(
        "Home initializers replaced",
        "system 311 had shattered_ring_start, replaced with a generic start.",
      ),
    );
  });

  it("names the player's capital from the galaxy", () => {
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    const html = renderToStaticMarkup(
      <ExportReportRows report={exportReport({ player_seat: 2, player_seat_kind: "preferred" })} />,
    );
    expect(html).toContain("Your capital, Barnard, is a weighted preferred seat");
  });

  it("words each row of the conversion, plural or singular, and each zone that missed its spot", () => {
    expect(seatsSummary(exportReport({ seats: 1 }), id)).toBe("1 seat.");
    expect(seatsSummary(exportReport({ player_seat: 217, player_seat_kind: "sol" }), id)).toBe(
      "17 seats. Your capital, system 217, is the Sol seat: only the United Nations of Earth can start there, and it will.",
    );
    expect(
      seatsSummary(exportReport({ player_seat: 217, player_seat_kind: "preferred" }), id),
    ).toBe(
      "17 seats. Your capital, system 217, is a weighted preferred seat: the likeliest start, not a certain one. For a certain one, reserve a letter and give your empire its trait.",
    );

    expect(fallenEmpiresSummary(exportReport())).toBeNull();
    expect(
      fallenEmpiresSummary(
        exportReport({
          fallen_empires: [
            {
              name: "Holy Guardians",
              kind: "spiritualist",
              systems_left_out: 1,
              links: 0,
              anchor: 5,
              exact: false,
            },
          ],
        }),
      ),
    ).toBe(
      "1 fallen empire zone at the old capital: Spiritualist. 1 system left out for the mod to " +
        "rebuild. 1 placed nearby: the old spot was not clear.",
    );
    expect(
      fallenEmpiresSummary(
        exportReport({
          fallen_empires: [
            {
              name: "Ancient Caretakers",
              kind: "materialist",
              systems_left_out: 5,
              links: 0,
              anchor: 792,
              exact: true,
            },
            {
              name: "Holy Guardians",
              kind: "spiritualist",
              systems_left_out: 13,
              links: 0,
              anchor: 793,
              exact: false,
            },
            {
              name: "Custodian Matrix",
              kind: "machine",
              systems_left_out: 11,
              links: 0,
              anchor: null,
              exact: false,
            },
          ],
        }),
      ),
    ).toBe(
      "3 fallen empire zones at the old capitals: Materialist, Spiritualist, Machine. " +
        "29 systems left out for the mod to rebuild. 1 anchor system added. " +
        "1 placed nearby: the old spot was not clear. Custodian Matrix has no clear spot within reach.",
    );

    expect(omittedLines(exportReport())).toEqual([]);
    expect(
      omittedLines(
        exportReport({
          omitted: [
            { category: "l_cluster", systems: 1 },
            { category: "marauder", systems: 4 },
          ],
        }),
      ),
    ).toEqual([
      "1 L-Cluster system left out: the game adds its own.",
      "4 Marauder systems left out: the game adds its own.",
    ]);

    expect(countsSummary(exportReport())).toBeNull();
    expect(countsSummary(exportReport({ setup_from_save: true }))).toBe(
      "Counts from the save's setup.",
    );

    expect(homeInitializerLines(exportReport(), id)).toEqual({ review: "", replaced: [] });
    expect(homeInitializerLines(PAINTED, id)).toEqual({
      review: "void_dwellers_start (system 12)",
      replaced: ["system 311 had shattered_ring_start, replaced with a generic start."],
    });
  });

  it("words the dropped bypasses as the file's own comment does", () => {
    expect(droppedSummary({ wormhole_pairs: 0, gateways: 0, lgates: 0 })).toBeNull();
    expect(droppedSummary({ wormhole_pairs: 1, gateways: 2, lgates: 0 })).toBe(
      "1 wormhole pair, 2 gateways",
    );
    expect(droppedSummary({ wormhole_pairs: 0, gateways: 0, lgates: 1 })).toBe("1 L-Gate");
  });
});

describe("the dialog", () => {
  it("is absent until an export is pending, then shows the report and the profile box", () => {
    expect(renderToStaticMarkup(<ExportDialog />)).toBe("");

    useFileSessionStore.setState({ pendingExport: FULL });
    const html = renderToStaticMarkup(<ExportDialog />);
    expect(html).toContain('aria-label="Export as scenario"');
    expect(html).toContain("Not carried over");
    expect(html).toContain("For the Paint a Galaxy mod");
    expect(html).toContain("Untick it only if the map is for a mod of your own.");
    expect(html.match(/<input type="checkbox"[^>]*>/)![0]).not.toContain("checked=");

    usePaintModStore.setState({ paintChoice: true });
    expect(
      renderToStaticMarkup(<ExportDialog />).match(/<input type="checkbox"[^>]*>/)![0],
    ).toContain("checked=");
  });

  it("shows the mod's state under the box only while it is ticked", () => {
    useFileSessionStore.setState({ pendingExport: FULL });
    usePaintModStore.setState({ known: true, paintMod: null });
    expect(renderToStaticMarkup(<ExportDialog />)).not.toContain("paint-mod-status");

    usePaintModStore.setState({ paintChoice: true });
    const html = renderToStaticMarkup(<ExportDialog />);
    expect(html).toContain("paint-mod-status");
    expect(html).toContain("Paint a Galaxy mod on the Steam Workshop");
  });

  it("ticking the box is the standing choice, kept per machine", () => {
    const box = elements(<PaintChoice />).find(
      (el): el is ReactElement<{ onChange: (e: unknown) => void }> => el.type === "input",
    )!;
    box.props.onChange({ currentTarget: { checked: true } });
    expect(usePaintModStore.getState().paintChoice).toBe(true);
    expect(stored.get("sgf.paint.profile")).toBe("true");
  });

  it("exports under the profile the box says on submit, and Cancel answers with none", () => {
    const confirmExport = vi.fn();
    useFileSessionStore.setState({ pendingExport: FULL, confirmExport });
    const preventDefault = vi.fn();

    form(<ExportForm report={FULL} />).props.onSubmit({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(confirmExport).toHaveBeenLastCalledWith("plain");

    usePaintModStore.setState({ paintChoice: true });
    form(<ExportForm report={FULL} />).props.onSubmit({ preventDefault });
    expect(confirmExport).toHaveBeenLastCalledWith("paint_a_galaxy");

    expect(renderToStaticMarkup(<ExportForm report={FULL} />)).toContain(
      '<button type="submit">Export</button>',
    );
    button(<ExportForm report={FULL} />, "Cancel").props.onClick();
    expect(confirmExport).toHaveBeenLastCalledWith(null);
  });
});
