import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { elements } from "../../test/elements";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { useFileSessionStore } from "../../store/fileSessionStore";
import { OPEN_RESULT, exportReport } from "../../store/fixture";
import { useGalaxyStore } from "../../store/galaxyStore";
import { usePaintModStore } from "../../store/paintModStore";
import { ExportDialog, ExportForm, ExportProfileCheck, ExportReportRows } from "./ExportDialog";
import { droppedSummary } from "./exportReport";

const FULL = exportReport({
  seats: 17,
  home_initializers: [
    { system: 311, initializer: "shattered_ring_start" },
    { system: 12, initializer: "void_dwellers_start" },
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
  stored.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  });
  useGalaxyStore.getState().clear();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState(), paintChoice: false });
  usePaintModStore.setState({ ...usePaintModStore.getInitialState() });
});

describe("the report", () => {
  it("lists the seats, the systems by category, and everything the export left out or needs", () => {
    const html = renderToStaticMarkup(<ExportReportRows report={FULL} />);
    expect(html).toContain(row("Empire seats", "17"));
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
        { system: 2, initializer: "shattered_ring_start" },
        { system: 311, initializer: "void_dwellers_start" },
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
    expect(html).toContain(row("Empire seats", "17"));
    expect(html).toContain(row("Systems", "Home 17 · Generic 774"));
    expect(html).not.toContain("Not carried over");
    expect(html).not.toContain("Needs");
    expect(html).not.toContain("Home initializers to review");
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

    useFileSessionStore.setState({ paintChoice: true });
    expect(
      renderToStaticMarkup(<ExportDialog />).match(/<input type="checkbox"[^>]*>/)![0],
    ).toContain("checked=");
  });

  it("shows the mod's state under the box only while it is ticked", () => {
    useFileSessionStore.setState({ pendingExport: FULL });
    usePaintModStore.setState({ known: true, paintMod: null });
    expect(renderToStaticMarkup(<ExportDialog />)).not.toContain("paint-mod-status");

    useFileSessionStore.setState({ paintChoice: true });
    const html = renderToStaticMarkup(<ExportDialog />);
    expect(html).toContain("paint-mod-status");
    expect(html).toContain("Paint a Galaxy mod on the Steam Workshop");
  });

  it("ticking the box is the standing choice, kept per machine", () => {
    const box = elements(<ExportProfileCheck />).find(
      (el): el is ReactElement<{ onChange: (e: unknown) => void }> => el.type === "input",
    )!;
    box.props.onChange({ currentTarget: { checked: true } });
    expect(useFileSessionStore.getState().paintChoice).toBe(true);
    expect(stored.get("sgf.paint.profile")).toBe("true");
  });

  it("exports under the profile the box says on submit, and Cancel answers with none", () => {
    const confirmExport = vi.fn();
    useFileSessionStore.setState({ pendingExport: FULL, confirmExport });
    const preventDefault = vi.fn();

    form(<ExportForm report={FULL} />).props.onSubmit({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(confirmExport).toHaveBeenLastCalledWith("plain");

    useFileSessionStore.setState({ paintChoice: true });
    form(<ExportForm report={FULL} />).props.onSubmit({ preventDefault });
    expect(confirmExport).toHaveBeenLastCalledWith("paint_a_galaxy");

    expect(renderToStaticMarkup(<ExportForm report={FULL} />)).toContain(
      '<button type="submit">Export</button>',
    );
    button(<ExportForm report={FULL} />, "Cancel").props.onClick();
    expect(confirmExport).toHaveBeenLastCalledWith(null);
  });
});
