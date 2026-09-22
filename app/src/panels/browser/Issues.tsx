import type { Severity } from "../../generated/Severity";
import type { AppIssue, AppIssueCode } from "../../lib/issues";
import { titleCase } from "../../lib/text";
import { issueCopy, issueGroups, issueTitle } from "../../store/browserRows";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { systemNameOf, useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import {
  baselineIssues,
  filteredIssues,
  newIssues,
  useIssuesStore,
  type IssueFilter,
} from "../../store/issuesStore";
import { openReservedSpawnsWorkshop } from "../chrome/paintMod";
import { useCollapse } from "./collapse";
import { Action, Group, Row } from "./rows";

const FILTER_LABELS: Record<IssueFilter, string> = {
  new: "From my edits",
  baseline: "Already in the save",
  all: "Everything",
};

/** What an empty list means, which depends on what was asked for. */
const EMPTY_LABELS: Record<IssueFilter, string> = {
  new: "Your edits have raised no issues.",
  baseline: "The file opened with nothing wrong.",
  all: "Nothing is wrong with this file.",
};

function FilterButton({ filter, count }: { filter: IssueFilter; count: number }) {
  const current = useIssuesStore((s) => s.filter);
  const setFilter = useIssuesStore((s) => s.setFilter);
  return (
    <button type="button" aria-pressed={current === filter} onClick={() => setFilter(filter)}>
      {FILTER_LABELS[filter]} · {count}
    </button>
  );
}

function CodeFilter({ codes }: { codes: AppIssueCode[] }) {
  const code = useIssuesStore((s) => s.code);
  const setCode = useIssuesStore((s) => s.setCode);
  if (codes.length < 2) return null;
  return (
    <select
      className="browser-code-filter"
      aria-label="Filter by kind"
      value={code ?? ""}
      onChange={(e) => setCode(e.target.value === "" ? null : (e.target.value as AppIssueCode))}
    >
      <option value="">Every kind</option>
      {codes.map((c) => (
        <option key={c} value={c}>
          {issueTitle(c)}
        </option>
      ))}
    </select>
  );
}

/** A row's own severity, for a group whose rows do not all share one. */
function SeverityDot({ severity }: { severity: Severity }) {
  const label = titleCase([severity]);
  return <span className={`browser-dot ${severity}`} role="img" aria-label={label} title={label} />;
}

/** What a row can do about its issue, by code; most codes have nothing but the jump. */
function IssueFix({ issue }: { issue: AppIssue }) {
  const updateEmpireCounts = useEditorStore((s) => s.updateEmpireCounts);
  const promptFeZoneFit = useEditorStore((s) => s.promptFeZoneFit);
  const addMarauderBases = useEditorStore((s) => s.addMarauderBases);
  const resetFeLinks = useEditorStore((s) => s.resetFeLinks);
  const dropDanglingFeLinks = useEditorStore((s) => s.dropDanglingFeLinks);
  const joinIslands = useEditorStore((s) => s.joinIslands);
  const { code } = issue;
  const [first] = issue.systems;
  const fix =
    code === "header_empire_count"
      ? { label: "Update counts", run: updateEmpireCounts }
      : code === "fe_zone_no_automatic"
        ? { label: "Fit zones…", run: promptFeZoneFit }
        : code === "reserved_spawns_missing"
          ? { label: "Subscribe ↗", run: openReservedSpawnsWorkshop }
          : code === "marauder_bases_missing" && first !== undefined
            ? { label: "Add the outposts", run: () => addMarauderBases(first) }
            : code === "fe_link_isolated" && first !== undefined
              ? { label: "Use nearest systems", run: () => resetFeLinks(first) }
              : code === "fe_link_dangling" && first !== undefined
                ? { label: "Unlink", run: () => dropDanglingFeLinks(first) }
                : code === "disconnected"
                  ? { label: "Join islands", run: joinIslands }
                  : null;
  if (fix === null) return null;
  return (
    <button type="button" className="browser-fix" onClick={() => void fix.run()}>
      {fix.label}
    </button>
  );
}

/** A save that stopped here, and the two ways out of it. */
function PausedSaveBar() {
  const paused = useFileSessionStore((s) => s.pausedSave);
  const resume = useFileSessionStore((s) => s.resumePausedSave);
  const dismiss = useFileSessionStore((s) => s.dismissPausedSave);
  if (paused === null) return null;
  const count = paused.count === 1 ? "1 issue" : `${paused.count} issues`;
  return (
    <div className="browser-paused">
      <span>⚠ Save paused with {count} to check</span>
      <button type="button" onClick={() => void resume()}>
        Save anyway
      </button>
      <button type="button" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
}

/** The validator's findings: what the file arrived with sits behind its own filter button. */
export function Issues() {
  const status = useFileSessionStore((s) => s.status);
  const issues = useIssuesStore((s) => s.issues);
  const setSelection = useEditorStore((s) => s.setSelection);
  const jumpTo = useEditorStore((s) => s.jumpTo);
  const baseline = useIssuesStore((s) => s.baseline);
  const filter = useIssuesStore((s) => s.filter);
  const code = useIssuesStore((s) => s.code);
  const systems = useGalaxyStore((s) => s.systems);
  const names = useGameDataStore((s) => s.names);
  const attention = useIssuesStore((s) => s.attention);
  const settle = useIssuesStore((s) => s.settle);
  const collapse = useCollapse("issues");

  if (status !== "ready") return null;
  const nameOf = (id: number): string => systemNameOf(systems, names, id);
  // The jump selects the system it lands on, so the whole set is put back afterwards.
  const go = async (issue: AppIssue): Promise<void> => {
    if (issue.systems.length === 0) return;
    await jumpTo(issue.systems[0]);
    await setSelection(issue.systems, "replace");
  };
  const fresh = newIssues(issues, baseline);
  const atLoad = baselineIssues(issues, baseline);
  const shown = filteredIssues(issues, baseline, filter, code);
  const codes = [...new Set(issues.map((i) => i.code))];

  return (
    <div
      className={attention ? "browser browser-attention" : "browser"}
      onPointerDown={settle}
      onFocus={settle}
    >
      <PausedSaveBar />
      <div className="browser-filters">
        <FilterButton filter="new" count={fresh.length} />
        <FilterButton filter="baseline" count={atLoad.length} />
        <FilterButton filter="all" count={issues.length} />
        <CodeFilter codes={codes} />
      </div>
      {shown.length === 0 && (
        <div className="muted">
          {code === null ? EMPTY_LABELS[filter] : "Nothing of that kind is listed."}
        </div>
      )}
      {issueGroups(shown, nameOf).map((group) => {
        const copy = issueCopy(group.code);
        return (
          <Group
            key={group.code}
            label={group.title}
            count={group.rows.length}
            error={group.error}
            note={
              <>
                {copy.why}
                <span className="browser-group-fix">{copy.fix}</span>
              </>
            }
            open={!collapse.collapsed(group.code)}
            onToggle={() => collapse.toggle(group.code)}
          >
            {group.rows.map(({ issue, systems: named }, i) => {
              const here = issue.systems.length > 0;
              return (
                <Row
                  key={`${group.code}-${i}`}
                  lead={group.mixed ? <SeverityDot severity={issue.severity} /> : undefined}
                  name={here ? named : issue.message}
                  title={issue.message}
                  subline={here && copy.detail ? issue.message : undefined}
                  stacked
                  onName={here ? () => void go(issue) : null}
                  actions={
                    <>
                      <IssueFix issue={issue} />
                      {here && (
                        <Action
                          glyph="⌖"
                          label="Focus these systems"
                          onClick={() => void go(issue)}
                        />
                      )}
                    </>
                  }
                />
              );
            })}
          </Group>
        );
      })}
    </div>
  );
}
