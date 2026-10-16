import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Dialog } from "../Dialog";
import { GroupTree, type GroupTreeProps } from "./GroupTree";
import { ListBox, type ListBoxProps } from "./ListBox";
import "./browse.css";
import { fallbackHighlight } from "./highlight";
import { useBeside, type BesidePoint } from "./useBeside";
import { useBrowserKeys } from "./useBrowserKeys";

/** How many rows are drawn before the list asks for a narrower search. */
const MAX_ROWS = 300;

export interface BrowseDialogProps<K extends string> {
  /** What the dialog is called to a screen reader. */
  label: string;
  /** A class of the caller's own beside the dialog's. */
  className?: string;
  /**
   * A point of the map area to open beside, with no scrim, so the map around it stays in view;
   * a press or a wheel turn outside the dialog closes it. Without one the dialog sits centred on
   * a scrim.
   */
  beside?: BesidePoint;
  onClose: () => void;
  /** The search field's label and placeholder. */
  searchLabel: string;
  query: string;
  onQuery: (query: string) => void;
  /** The line under the search. */
  hint?: ReactNode;
  tree: GroupTreeProps;
  /** Every row the search and the group leave, in order; the list draws the first few hundred. */
  keys: readonly K[];
  rows: Pick<ListBoxProps<K>, "label" | "idPrefix" | "rowClassName" | "renderRow">;
  /** Shown in place of the list while its rows are still being read. */
  waiting?: string;
  highlighted: K | null;
  onHighlight: (key: K) => void;
  /** Picks the highlighted row, keeping the browser open when asked. */
  onChoose: (keepOpen: boolean) => void;
  onPin: (key: K) => void;
  /** The pane right of the list. */
  detail: ReactNode;
  /** The row of actions along the bottom. */
  foot: ReactNode;
}

/**
 * A large browser dialog over the map: a search with its hint across the top, the groups down
 * the left, the list of rows, a detail pane and a foot of actions. Its keys are `useBrowserKeys`.
 */
export function BrowseDialog<K extends string>({
  label,
  className,
  beside,
  onClose,
  searchLabel,
  query,
  onQuery,
  hint,
  tree,
  keys,
  rows,
  waiting,
  highlighted,
  onHighlight,
  onChoose,
  onPin,
  detail,
  foot,
}: BrowseDialogProps<K>) {
  const inner = useRef<HTMLDivElement>(null);
  const placed = useBeside(beside, inner, onClose);
  const shown = useMemo(() => keys.slice(0, MAX_ROWS), [keys]);
  const more = keys.length - shown.length;
  const { search, onKeyDown } = useBrowserKeys({
    keys: shown,
    highlighted,
    onHighlight,
    onChoose,
    onPin,
  });

  useEffect(() => {
    const to = fallbackHighlight(shown, highlighted);
    if (to !== null) onHighlight(to);
  }, [shown, highlighted, onHighlight]);

  return (
    <Dialog
      className={["browse", beside && "browse-beside", className].filter(Boolean).join(" ")}
      style={placed}
      scrim="browse-scrim"
      label={label}
      onClose={onClose}
      onDismiss={beside === undefined ? onClose : undefined}
    >
      <div ref={inner} className="browse-inner" onKeyDown={onKeyDown}>
        <div className="browse-head">
          <button
            type="button"
            className="link browse-close"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
          >
            ×
          </button>
          <input
            ref={search}
            type="search"
            className="browse-search"
            aria-label={searchLabel}
            placeholder={searchLabel}
            autoComplete="off"
            autoFocus
            value={query}
            onChange={(e) => onQuery(e.currentTarget.value)}
          />
          {hint !== undefined && <div className="muted browse-hint">{hint}</div>}
        </div>
        <div className="browse-cols">
          <GroupTree {...tree} />
          {waiting !== undefined ? (
            <div className="muted browse-empty">{waiting}</div>
          ) : (
            <ListBox
              {...rows}
              keys={shown}
              highlighted={highlighted}
              more={more}
              onHighlight={onHighlight}
              onChoose={() => onChoose(false)}
            />
          )}
          {detail}
        </div>
        <div className="browse-foot">{foot}</div>
      </div>
    </Dialog>
  );
}
