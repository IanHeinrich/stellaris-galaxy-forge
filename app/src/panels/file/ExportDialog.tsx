import type { FormEvent } from "react";
import type { ExportReport } from "../../generated/ExportReport";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { systemNameOf, useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { usePaintModStore } from "../../store/paintModStore";
import { Dialog } from "../Dialog";
import {
  CATEGORY_LABELS,
  countsSummary,
  fallenEmpiresSummary,
  homeInitializerLines,
  omittedLines,
  seatsSummary,
} from "./exportReport";
import "./open.css";
import { PaintChoice } from "./PaintChoice";

/** What the export carries over and what it leaves out, one row per fact that applies. */
export function ExportReportRows({ report }: { report: ExportReport }) {
  const systems = useGalaxyStore((s) => s.systems);
  const names = useGameDataStore((s) => s.names);
  const nameOf = (id: number) =>
    systems.has(id) ? systemNameOf(systems, names, id) : `system ${id}`;
  const dropped = report.dropped_summary ?? null;
  const fallen = fallenEmpiresSummary(report);
  const omitted = omittedLines(report);
  const counts = countsSummary(report);
  const needs = report.sources.map((s) => s.source).join(", ");
  const homes = homeInitializerLines(report, nameOf);
  return (
    <dl className="export-report">
      <dt>Seats</dt>
      <dd>{seatsSummary(report, nameOf)}</dd>
      <dt>Systems</dt>
      <dd>
        {report.by_category.map((c) => `${CATEGORY_LABELS[c.category]} ${c.systems}`).join(" · ")}
      </dd>
      {fallen !== null && (
        <>
          <dt>Fallen empires</dt>
          <dd>{fallen}</dd>
        </>
      )}
      {omitted.length > 0 && (
        <>
          <dt>Left out</dt>
          <dd>{omitted.join(" ")}</dd>
        </>
      )}
      {counts !== null && (
        <>
          <dt>Counts</dt>
          <dd>{counts}</dd>
        </>
      )}
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
      {homes.review !== "" && (
        <>
          <dt>Home initializers to review</dt>
          <dd>{homes.review}</dd>
        </>
      )}
      {homes.replaced.length > 0 && (
        <>
          <dt>Home initializers replaced</dt>
          <dd>{homes.replaced.join(" ")}</dd>
        </>
      )}
    </dl>
  );
}

/** The report, the profile box and the two ways out; Enter exports under the profile the box says. */
export function ExportForm({ report }: { report: ExportReport }) {
  const paint = usePaintModStore((s) => s.paintChoice);
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
        <PaintChoice />
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
