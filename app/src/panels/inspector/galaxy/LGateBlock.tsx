import type { LGate } from "../../../generated/LGate";
import type { LGateOutcome } from "../../../generated/LGateOutcome";
import {
  LGATE_MOD_WARNING_LIMIT,
  LGATE_OPENED_TITLE,
  LGATE_OUTCOME_LABELS,
  LGATE_OUTCOMES,
  LGATE_TEMPEST_NOTE,
  lgateModWarningLine,
  lgateModWarnings,
} from "../../../lib/lgate";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useLGateStore } from "../../../store/lgateStore";
import { EditBlock, EditNote, EditRow, PickerField } from "../../EditField";
import { useApplyOp } from "../../useApplyOp";

const OUTCOMES = LGATE_OUTCOMES.map((key) => ({ key, label: LGATE_OUTCOME_LABELS[key] }));

/** The outcome day one rolled for the L-Cluster, behind Reveal, and editable until a gate opens. */
export function LGateBlock({ lgate }: { lgate: LGate }) {
  const applyOp = useApplyOp();
  const revealed = useLGateStore((s) => s.revealed);
  const reveal = useLGateStore((s) => s.reveal);
  const hide = useLGateStore((s) => s.hide);
  const lgateMods = useGameDataStore((s) => s.lgateMods);
  const modWarnings = revealed ? lgateModWarnings(lgateMods) : [];
  const shownWarnings = modWarnings.slice(0, LGATE_MOD_WARNING_LIMIT);
  const moreWarnings = modWarnings.length - shownWarnings.length;
  return (
    <EditBlock title="L-Gate">
      <EditRow label="Outcome">
        {revealed ? (
          <span className="ins-lgate-outcome">
            <PickerField
              label="L-Gate outcome"
              disabledReason={lgate.opened ? LGATE_OPENED_TITLE : undefined}
              current={{ key: lgate.outcome, label: LGATE_OUTCOME_LABELS[lgate.outcome] }}
              items={OUTCOMES}
              onPick={(key) => applyOp({ type: "SetLGateOutcome", outcome: key as LGateOutcome })}
            />
            <button type="button" className="link" onClick={() => hide()}>
              Hide
            </button>
          </span>
        ) : (
          <button type="button" className="link" onClick={() => reveal()}>
            Reveal
          </button>
        )}
      </EditRow>
      {revealed && !lgate.opened && lgate.outcome === "gray_tempest" && (
        <EditNote>{LGATE_TEMPEST_NOTE}</EditNote>
      )}
      {shownWarnings.map((warning) => (
        <EditNote key={warning.mod}>
          <span title={warning.title}>{lgateModWarningLine(warning.mod)}</span>
        </EditNote>
      ))}
      {moreWarnings > 0 && <EditNote>and {moreWarnings} more</EditNote>}
    </EditBlock>
  );
}
