import type { ReactNode } from "react";
import { footerOpens, type FooterOpen, type OpenLists, type Row } from "../../lib/openRows";
import { useOpenScreenStore } from "../../store/openScreenStore";
import { usePaintModStore } from "../../store/paintModStore";
import { OPEN_KEYS } from "./openKeys";

/** The open screen's buttons: New scenario and Browse, then the ones that open the selection. */
export function OpenFooter({
  row,
  lists,
  idle,
  onNewScenario,
  onBrowse,
  onAsScenario,
  children,
}: {
  row: Row | undefined;
  lists: OpenLists;
  idle: boolean;
  onNewScenario: () => void;
  onBrowse: () => void;
  onAsScenario: (path: string) => void;
  children?: ReactNode;
}) {
  const paintMod = usePaintModStore((s) => s.paintMod);
  const footer = footerOpens(row, lists, paintMod);
  const open = (target: FooterOpen | null) => {
    if (!idle) return;
    if (target?.mode === "scenario") onAsScenario(target.path);
    else if (target) void useOpenScreenStore.getState().open(target.path, target.mode);
  };
  return (
    <div className="open-dialog-foot">
      <div className="open-actions">
        <button type="button" onClick={onNewScenario}>
          New scenario…
        </button>
        <button type="button" onClick={onBrowse}>
          Browse…
        </button>
        <span className="spacer" />
        {footer.asScenario && (
          <button
            type="button"
            title={`Take its galaxy into a new scenario (${OPEN_KEYS.asScenario.label})`}
            aria-disabled={!idle}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => open(footer.asScenario)}
          >
            Open as scenario
          </button>
        )}
        {footer.forPaint && (
          <button
            type="button"
            title="Edit it for the Paint a Galaxy mod"
            aria-disabled={!idle}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (footer.forPaint && idle) {
                void useOpenScreenStore.getState().open(footer.forPaint, "save", true);
              }
            }}
          >
            Open for Paint a Galaxy
          </button>
        )}
        <button
          type="button"
          className="open-primary"
          title={`Open it as it is (${OPEN_KEYS.open.label} asks first for a save)`}
          aria-disabled={footer.open === null || !idle}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => open(footer.open)}
        >
          Open
        </button>
      </div>
      {children}
    </div>
  );
}
