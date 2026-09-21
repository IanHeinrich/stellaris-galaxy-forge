import type { AppIssue, AppIssueCode } from "../../lib/issues";
import { issueGroups, issueTitle } from "../../store/browserRows";
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
  new: "New",
  baseline: "At load",
  all: "All",
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
      aria-label="Filter by code"
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

/** What a row can do about its issue, by code; most codes have nothing but the jump. */
function IssueFix({ code }: { code: AppIssueCode }) {
  const updateEmpireCounts = useEditorStore((s) => s.updateEmpireCounts);
  const promptFeZoneFit = useEditorStore((s) => s.promptFeZoneFit);
  const fix =
    code === "header_empire_count"
      ? { label: "Update counts", run: updateEmpireCounts }
      : code === "fe_zone_no_automatic"
        ? { label: "Fit zones…", run: promptFeZoneFit }
        : code === "reserved_spawns_missing"
          ? { label: "Subscribe ↗", run: openReservedSpawnsWorkshop }
          : null;
  if (fix === null) return null;
  return (
    <button type="button" className="browser-fix" onClick={() => void fix.run()}>
      {fix.label}
    </button>
  );
}

/** The validator's findings: what the save arrived with sits behind the "At load" filter. */
export function Issues() {
  const status = useFileSessionStore((s) => s.status);
  const issues = useFileSessionStore((s) => s.issues);
  const setSelection = useEditorStore((s) => s.setSelection);
  const jumpTo = useEditorStore((s) => s.jumpTo);
  const baseline = useIssuesStore((s) => s.baseline);
  const filter = useIssuesStore((s) => s.filter);
  const code = useIssuesStore((s) => s.code);
  const setFilter = useIssuesStore((s) => s.setFilter);
  const systems = useGalaxyStore((s) => s.systems);
  const names = useGameDataStore((s) => s.names);
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
    <div className="browser">
      <div className="browser-filters">
        <FilterButton filter="new" count={fresh.length} />
        <FilterButton filter="baseline" count={atLoad.length} />
        <FilterButton filter="all" count={issues.length} />
        <CodeFilter codes={codes} />
      </div>
      {shown.length === 0 && (
        <div className="muted">
          {filter === "new" ? "No issues since this save was opened." : "Nothing to show."}
        </div>
      )}
      {issueGroups(shown, nameOf).map((group) => (
        <Group
          key={group.code}
          label={group.title}
          count={group.rows.length}
          error={group.error}
          lead={<span className="browser-code">{group.code}</span>}
          open={!collapse.collapsed(group.code)}
          onToggle={() => collapse.toggle(group.code)}
        >
          {group.rows.map(({ issue, systems: named }, i) => (
            <Row
              key={`${group.code}-${i}`}
              lead={
                <span
                  className={
                    issue.severity === "error" ? "browser-severity error" : "browser-severity"
                  }
                >
                  {issue.severity}
                </span>
              }
              name={named}
              title={issue.message}
              onName={() => void go(issue)}
              actions={
                <>
                  <IssueFix code={issue.code} />
                  <Action glyph="⌖" label="Focus these systems" onClick={() => void go(issue)} />
                </>
              }
            />
          ))}
        </Group>
      ))}
      {filter === "new" && atLoad.length > 0 && (
        <div className="browser-note">
          {atLoad.length} {atLoad.length === 1 ? "issue was" : "issues were"} in the save when it
          was opened
          <button type="button" onClick={() => setFilter("baseline")}>
            show
          </button>
        </div>
      )}
    </div>
  );
}
