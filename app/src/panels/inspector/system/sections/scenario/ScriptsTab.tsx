import { useEffect, useMemo, useState } from "react";
import type { ReferenceVia } from "../../../../../generated/ReferenceVia";
import type { ScriptRow } from "../../../../../generated/ScriptRow";
import type { ScriptRowKind } from "../../../../../generated/ScriptRowKind";
import type { ScriptSite } from "../../../../../generated/ScriptSite";
import type { ScriptTiming } from "../../../../../generated/ScriptTiming";
import { useScriptsStore } from "../../../../../store/scriptsStore";
import { Twisty } from "../../../../Twisty";
import { Chip, Empty, FILTER_MIN, FilterField, MoreButton } from "../../../parts";
import { ScriptActions } from "./scriptActions";
import { groupRows, rowKey, summaryLine } from "./scriptRows";
import "./scripts.css";

const KIND_LABEL: Record<ScriptRowKind, string> = {
  initializer: "Initializer",
  spawned_initializer: "Spawned initializers",
  scripted_effect: "Scripted effects",
  scenario_effect: "Scenario effect",
  event: "Events",
  on_action: "On actions",
};

const KIND_GLYPH: Record<ScriptRowKind, string> = {
  initializer: "✦",
  spawned_initializer: "✧",
  scripted_effect: "ƒ",
  scenario_effect: "▤",
  event: "!",
  on_action: "⟳",
};

const TIMING_LABEL: Record<ScriptTiming, string> = {
  generation: "at generation",
  day_one: "day 1",
  later: "runs later",
  unknown: "timing unknown",
};

const TIMING_TITLE: Record<ScriptTiming, string> = {
  generation: "Runs while the galaxy is generated",
  day_one: "Runs on the first day, from an event on_game_start fires",
  later: "Runs once the game is under way",
  unknown: "Nothing in the loaded game data says when this runs",
};

const HAS_FLAG: Partial<Record<ReferenceVia, string>> = {
  star_flag: "has_star_flag",
  global_flag: "has_global_flag",
  planet_flag: "has_planet_flag",
};

export const SCRIPTS_LIMITS =
  "Scripts that reference this system by initializer, star flag or event target. It will not " +
  "find scripts that iterate over classes of systems or address them by name. Conditions " +
  "(if, limit) are read as if they were true.";

/** What the Overview's closed Scripts row says on hover, and where it sends the reader. */
export const SCRIPTS_TAB_TITLE = "Every script that reaches this system, on the Scripts tab";

/** How many rows the backend lists before it stops; the footnote says so when it did. */
const SHOWN = 200;

/** What made the script a reference to this system, as the script itself writes it. */
function viaPhrase(via: ReferenceVia | null, token: string | null): string | null {
  if (via === null) return null;
  const key = HAS_FLAG[via];
  if (key !== undefined) return token === null ? key : `${key} = ${token}`;
  if (via === "event_target") return token === null ? "event target" : `event_target:${token}`;
  if (via === "initializer") return token === null ? "initializer" : `initializer = ${token}`;
  return token === null ? "called by the chain" : `calls ${token}`;
}

/** One line of a script that names several: where in the file, what it wrote, and the ways out. */
function SiteRow({ site }: { site: ScriptSite }) {
  const via = viaPhrase(site.via, site.token);
  return (
    <div className="ins-script-site" title={site.location.display}>
      <span className="mono ins-script-line">:{site.location.line}</span>
      <span className="mono ins-script-path">{via ?? site.location.display}</span>
      <ScriptActions file={site.location.file} />
    </div>
  );
}

/** The head of a row: what the script is, when it runs, and where the reader can open it. */
function RowHead({ row }: { row: ScriptRow }) {
  const first = row.sites[0];
  const many = row.site_count > 1;
  const via = viaPhrase(first.via, first.token);
  return (
    <>
      <span className="pi ghost" title={KIND_LABEL[row.kind]}>
        {KIND_GLYPH[row.kind]}
      </span>
      <span>
        <span className="l1">
          {many && <Twisty />}
          <span className="mono">{row.name}</span>
          {many && <span className="ins-script-count">×{row.site_count}</span>}
          <Chip title={TIMING_TITLE[row.timing]}>{TIMING_LABEL[row.timing]}</Chip>
        </span>
        {row.title !== null && <span className="l2">{row.title}</span>}
        {((!many && via !== null) || row.fired_by !== null) && (
          <span className="l2">
            {!many && via !== null && <span className="mono">{via}</span>}
            {row.fired_by !== null && <span>fired by {row.fired_by}</span>}
          </span>
        )}
        <span className="l2 ins-script-where" title={many ? undefined : first.location.display}>
          {many ? (
            <span>{summaryLine(row)}</span>
          ) : (
            <>
              <span className="mono ins-script-path">{first.location.display}</span>
              <span>{first.location.layer}</span>
            </>
          )}
        </span>
      </span>
      <ScriptActions file={first.location.file} />
    </>
  );
}

/** One script. A script that names the system on one line shows that line and does not open. */
function Row({ row }: { row: ScriptRow }) {
  if (row.site_count <= 1) {
    return (
      <div className="ins-prow static">
        <RowHead row={row} />
      </div>
    );
  }
  return (
    <details className="ins-script">
      <summary className="ins-prow ins-script-row">
        <RowHead row={row} />
      </summary>
      <div className="ins-script-sites">
        {row.sites.map((site) => (
          <SiteRow key={site.location.display} site={site} />
        ))}
        {row.sites.length < row.site_count && (
          <Empty>
            showing the first {row.sites.length} of {row.site_count}
          </Empty>
        )}
      </div>
    </details>
  );
}

/**
 * Every script the loaded game data has that reaches this scenario system: what it is generated
 * from, the effects that chain calls, and what names it by flag or event target afterwards.
 */
export function ScriptsTab({ system }: { system: number }) {
  const request = useScriptsStore((s) => s.request);
  const scripts = useScriptsStore((s) => s.scripts.get(system));
  const missing = useScriptsStore((s) => s.missing.has(system));
  const failed = useScriptsStore((s) => s.failed.get(system));
  const version = useScriptsStore((s) => s.version);
  const [query, setQuery] = useState("");
  const [uncapped, setUncapped] = useState<ReadonlySet<ScriptRowKind>>(new Set());

  useEffect(() => request(system), [system, request, version]);

  const rows = useMemo(() => scripts?.rows ?? [], [scripts]);
  const grouped = useMemo(() => groupRows(rows, query, uncapped), [rows, query, uncapped]);
  return (
    <>
      {scripts === undefined ? (
        <Empty>{waitingText(missing, failed)}</Empty>
      ) : (
        <>
          {rows.length > FILTER_MIN && (
            <FilterField
              label={`Filter ${rows.length} scripts`}
              value={query}
              onChange={setQuery}
            />
          )}
          {grouped.pinned.map((row) => (
            <Row key={rowKey(row)} row={row} />
          ))}
          {grouped.groups.map((group) => (
            <div key={group.kind}>
              <div className="muted ins-spawn-head">{KIND_LABEL[group.kind]}</div>
              {group.rows.map((row) => (
                <Row key={rowKey(row)} row={row} />
              ))}
              {group.hidden > 0 && (
                <MoreButton
                  count={group.hidden}
                  where={KIND_LABEL[group.kind].toLowerCase()}
                  onClick={() => setUncapped((kinds) => new Set(kinds).add(group.kind))}
                />
              )}
            </div>
          ))}
          {grouped.matched === 0 && <Empty>No script here matches that.</Empty>}
        </>
      )}
      {scripts?.truncated === true && <Empty>showing the first {SHOWN}</Empty>}
      <Empty>{SCRIPTS_LIMITS}</Empty>
    </>
  );
}

/** What stands in for the rows: still reading, nothing to read, or why the reading failed. */
function waitingText(missing: boolean, failed: string | undefined): string {
  if (failed !== undefined) return `The scripts could not be read: ${failed}`;
  if (missing) return "No scripts in the loaded game data reach this system.";
  return "Reading the scripts that reach this system…";
}
