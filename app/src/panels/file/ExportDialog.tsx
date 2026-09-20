import type { FormEvent } from "react";
import type { Category } from "../../generated/Category";
import type { ExportReport } from "../../generated/ExportReport";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { systemNameOf, useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { Dialog } from "../overlays/Dialog";
import { droppedSummary } from "./exportReport";
import "./open.css";
import { PAINT_CHECK, PAINT_WHY } from "./paintCopy";

const CATEGORY_LABELS: Record<Category, string> = {
  home: "Home",
  fallen_empire: "Fallen empire",
  marauder: "Marauder",
  ratling: "Ratling",
  l_cluster: "L-Cluster",
  guaranteed_colony: "Guaranteed colony",
  special: "Special",
  generic: "Generic",
};

/** What the export carries over and what it leaves out, one row per fact that applies. */
export function ExportReportRows({ report }: { report: ExportReport }) {
  const systems = useGalaxyStore((s) => s.systems);
  const names = useGameDataStore((s) => s.names);
  const dropped = droppedSummary(report.dropped);
  const needs = report.sources.map((s) => s.source).join(", ");
  const homes = report.home_initializers
    .map((h) => {
      const where = systems.has(h.system)
        ? systemNameOf(systems, names, h.system)
        : `system ${h.system}`;
      return `${h.initializer} (${where})`;
    })
    .join(", ");
  return (
    <dl className="export-report">
      <dt>Empire seats</dt>
      <dd>{report.seats}</dd>
      <dt>Systems</dt>
      <dd>
        {report.by_category.map((c) => `${CATEGORY_LABELS[c.category]} ${c.systems}`).join(" · ")}
      </dd>
      {dropped !== null && (
        <>
          <dt>Not carried over</dt>
          <dd>{dropped}</dd>
        </>
      )}
      {needs !== "" && (
        <>
          <dt>Needs</dt>
          <dd>{needs}</dd>
        </>
      )}
      {homes !== "" && (
        <>
          <dt>Home initializers to review</dt>
          <dd>{homes}</dd>
        </>
      )}
    </dl>
  );
}

/** Whether the file is written for the Paint a Galaxy mod; the choice is kept per machine. */
export function ExportProfileCheck() {
  const paint = useFileSessionStore((s) => s.paintExport);
  const setPaintExport = useFileSessionStore((s) => s.setPaintExport);
  return (
    <label className="setup-check">
      <input
        type="checkbox"
        checked={paint}
        onChange={(e) => setPaintExport(e.currentTarget.checked)}
      />
      <span>
        {PAINT_CHECK}
        <span className="setup-why">{PAINT_WHY}</span>
      </span>
    </label>
  );
}

/** The report, the profile box and the two ways out; Enter exports under the profile the box says. */
export function ExportForm({ report }: { report: ExportReport }) {
  const paint = useFileSessionStore((s) => s.paintExport);
  const confirmExport = useFileSessionStore((s) => s.confirmExport);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void confirmExport(paint ? "paint_a_galaxy" : "plain");
  };
  return (
    <form onSubmit={submit}>
      <div className="open-dialog-head">
        <h1>Export as scenario</h1>
      </div>
      <div className="open-dialog-body">
        <ExportReportRows report={report} />
        <ExportProfileCheck />
      </div>
      <div className="open-dialog-foot">
        <div className="setup-actions">
          <button type="button" onClick={() => void confirmExport(null)}>
            Cancel
          </button>
          <button type="submit">Export</button>
        </div>
      </div>
    </form>
  );
}

/** What an export of the open save would carry over, before the file dialog asks where to put it. */
export function ExportDialog() {
  const report = useFileSessionStore((s) => s.pendingExport);
  const confirmExport = useFileSessionStore((s) => s.confirmExport);
  if (report === null) return null;

  const cancel = () => void confirmExport(null);
  return (
    <Dialog className="open-dialog" label="Export as scenario" onClose={cancel} onDismiss={cancel}>
      <ExportForm report={report} />
    </Dialog>
  );
}
