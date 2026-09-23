import type { MouseEvent, RefObject } from "react";
import type {
  CampaignRow,
  RecentRow,
  Row,
  SaveRow,
  ScenarioRow,
  Section,
} from "../../lib/openRows";
import { CLOUD_TITLE } from "../../lib/sessionCopy";
import { useOpenScreenStore } from "../../store/openScreenStore";
import { Twisty } from "../Twisty";
import { EmpireMark, IRONMAN_TITLE, PaintTag } from "./OpenDetails";
import { formatSize, formatWhen } from "./launchData";

function CloudFlag({ cloud }: { cloud: boolean }) {
  if (!cloud) return null;
  return (
    <span className="flag" title={CLOUD_TITLE}>
      ☁
    </span>
  );
}

function RecentRowLine({ row, onForget }: { row: RecentRow; onForget: () => void }) {
  const scenarios = useOpenScreenStore((s) => s.scenarios);
  return (
    <>
      <span className="open-main">
        <span className={row.missing ? "open-title gone" : "open-title"}>
          <span className="flag kind">{row.doc.kind === "save" ? "SAVE" : "SCENARIO"}</span>
          {row.doc.title}
          {row.doc.kind === "scenario" && <PaintTag path={row.doc.path} listings={scenarios} />}
        </span>
        <span className="open-sub">{row.doc.subtitle || row.doc.path}</span>
      </span>
      <span className="open-side">
        {row.missing ? (
          <span className="warn">not found</span>
        ) : (
          formatWhen(row.doc.openedAt / 1000)
        )}
      </span>
      {row.missing && (
        <button
          type="button"
          className="ghost"
          tabIndex={-1}
          title="Remove it from the list"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onForget();
          }}
        >
          forget
        </button>
      )}
    </>
  );
}

function CampaignRowLine({ row }: { row: CampaignRow }) {
  return (
    <>
      <span className="open-main">
        <span className="open-title">
          <Twisty open={row.expanded} />
          <EmpireMark meta={row.campaign.meta} size="row" />
          {row.empire}
          <CloudFlag cloud={row.campaign.cloud} />
        </span>
        <span className="open-sub">
          {row.subtitle}
          {row.error && <span className="warn"> · {row.error}</span>}
        </span>
      </span>
      <span className="open-side">
        {row.loading ? "reading…" : row.count}
        <span>{formatWhen(row.campaign.newest)}</span>
      </span>
    </>
  );
}

function SaveRowLine({ row }: { row: SaveRow }) {
  return (
    <>
      <span className="open-main">
        <span className="open-title">
          <span className="open-date">{row.title}</span>
          {row.autosave && <span className="flag">autosave</span>}
          <CloudFlag cloud={row.file.cloud} />
          {row.file.meta?.ironman && (
            <span className="flag" title={IRONMAN_TITLE}>
              ⚿
            </span>
          )}
        </span>
      </span>
      <span className="open-side">{formatWhen(row.file.modified)}</span>
    </>
  );
}

function ScenarioRowLine({ row }: { row: ScenarioRow }) {
  const { listing } = row;
  return (
    <>
      <span className="open-main">
        <span className="open-title">
          {listing.name}
          <PaintTag path={listing.path} listings={[listing]} />
          {!listing.enabled && listing.source === "mod" && (
            <span className="flag" title="The playset does not carry this mod">
              not in playset
            </span>
          )}
        </span>
        <span className="open-sub">
          {row.subtitle}
          {listing.shadowed_by && (
            <span className="warn"> · overridden by {listing.shadowed_by}</span>
          )}
          {listing.error && <span className="warn"> · {listing.error}</span>}
        </span>
      </span>
      <span className="open-side">
        {formatSize(listing.size)}
        <span>{formatWhen(listing.modified)}</span>
      </span>
    </>
  );
}

export function RowLine({ row, onForget }: { row: Row; onForget: (path: string) => void }) {
  switch (row.kind) {
    case "recent":
      return <RecentRowLine row={row} onForget={() => onForget(row.doc.path)} />;
    case "campaign":
      return <CampaignRowLine row={row} />;
    case "save":
      return <SaveRowLine row={row} />;
    case "scenario":
      return <ScenarioRowLine row={row} />;
  }
}

/** The path a row opens, for the busy state and any error it reports. */
function rowPath(row: Row): string | null {
  switch (row.kind) {
    case "recent":
      return row.doc.path;
    case "save":
      return row.file.path;
    case "scenario":
      return row.listing.path;
    default:
      return null;
  }
}

function rowTitle(row: Row): string | undefined {
  if (row.kind === "scenario" && row.listing.error) return row.listing.error;
  return rowPath(row) ?? undefined;
}

export function SectionRows({
  section,
  current,
  busy,
  rowError,
  rows,
  onPress,
  onForget,
}: {
  section: Section;
  current: Row | undefined;
  busy: string | null;
  rowError: { path: string; message: string } | null;
  rows: RefObject<Map<string, HTMLDivElement>>;
  onPress: (row: Row, e: MouseEvent) => void;
  onForget: (path: string) => void;
}) {
  return (
    <section className="open-section">
      <div className="open-heading">{section.label}</div>
      {section.note && <div className="open-note">{section.note}</div>}
      {section.notices.map((notice, i) => (
        <div key={`${i}:${notice}`} className="open-note warn">
          {notice}
        </div>
      ))}
      {section.rows.map((row, i) => {
        const path = rowPath(row);
        const opening = path !== null && path === busy;
        const error = path !== null && rowError?.path === path ? rowError.message : null;
        const group = row.kind === "scenario" ? row.group : null;
        const before = section.rows[i - 1];
        const shownGroup =
          group !== null && group !== (before?.kind === "scenario" ? before.group : null);
        const classes = ["open-row", `open-${row.kind}`];
        if (row === current) classes.push("active");
        if (opening) classes.push("busy");
        if (row.kind === "scenario" && row.disabled) classes.push("disabled");
        if (row.kind === "scenario" && row.listing.shadowed_by) classes.push("shadowed");
        return (
          <div key={row.key} className={row.kind === "save" ? "open-nested" : undefined}>
            {shownGroup && <div className="open-group">{group}</div>}
            <div
              id={`open-row-${row.key}`}
              ref={(el) => {
                if (el) rows.current.set(row.key, el);
                return () => {
                  rows.current.delete(row.key);
                };
              }}
              role="option"
              aria-selected={row === current}
              aria-disabled={row.kind === "scenario" && row.disabled}
              className={classes.join(" ")}
              title={rowTitle(row)}
              onMouseDown={(e) => {
                e.preventDefault();
                onPress(row, e);
              }}
            >
              <RowLine row={row} onForget={onForget} />
              {error && <div className="open-row-error">{error}</div>}
            </div>
          </div>
        );
      })}
    </section>
  );
}
