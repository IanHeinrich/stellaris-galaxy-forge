import { useState } from "react";
import type { Named } from "../../../../generated/Named";
import type { SystemDetails } from "../../../../generated/SystemDetails";
import { useGameDataStore } from "../../../../store/gameDataStore";
import { applyGeometry, useSystemGeometry } from "../../../../store/systemGeometry";
import type { GeometryIntent } from "../../../../lib/details/orbitEdits";
import { EditNote, EditRow, PickerField, TextField } from "../../../EditField";
import { LockedRow, Section } from "../../parts";

const KINDS_NEED_GAME_DATA = "Load the game data to change a belt's kind";
const NO_KINDS: readonly Named[] = [];

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function kindName(kind: string, kinds: readonly Named[]): string {
  return kinds.find((k) => k.key === kind)?.name ?? kind;
}

type Send = (intent: GeometryIntent) => void;

/** One belt's kind, radius and removal, each its own edit. */
function BeltRows({
  system,
  index,
  kind,
  radius,
  kinds,
  send,
}: {
  system: number;
  index: number;
  kind: string;
  radius: number;
  kinds: readonly Named[];
  send: Send;
}) {
  const n = index + 1;
  const kindField =
    kinds.length === 0 ? (
      <LockedRow label={`Belt ${n}`} reason={KINDS_NEED_GAME_DATA}>
        <span className="mono">{kind}</span>
      </LockedRow>
    ) : (
      <EditRow label={`Belt ${n}`}>
        <PickerField
          label={`Belt ${n} kind`}
          title="What the belt is made of"
          current={{ key: kind, label: kindName(kind, kinds) }}
          items={kinds.map((k) => ({ key: k.key, label: k.name }))}
          onPick={(beltKind) => send({ kind: "setBeltKind", system, index, beltKind })}
        />
      </EditRow>
    );
  return (
    <>
      {kindField}
      <EditRow label="Radius">
        <span className="sys-belt-radius">
          <TextField
            kind="number"
            label={`Belt ${n} radius`}
            title="How far the belt is from the star. Its asteroids move with it."
            value={rounded(radius)}
            onCommit={(to) => send({ kind: "setBeltRadius", system, index, radius: to })}
          />
          <button
            type="button"
            className="link"
            title="Remove this belt. Its asteroids stay where they are."
            aria-label={`Remove belt ${n}`}
            onClick={() => send({ kind: "removeBelt", system, index })}
          >
            ×
          </button>
        </span>
      </EditRow>
    </>
  );
}

/**
 * A save system's asteroid belts and inner radius: fields for what the system lets change, plain
 * text for the rest.
 */
export function BeltSection({ details }: { details: SystemDetails }) {
  const system = details.id;
  const { layout, editing } = useSystemGeometry(system);
  const kinds = useGameDataStore((s) => s.summary?.belt_kinds ?? NO_KINDS);
  const [refusal, setRefusal] = useState<string | null>(null);
  const belts = layout.belts;
  const inner = details.inner_radius;
  if (inner === null && belts.length === 0) return null;
  const send: Send = (intent) => {
    setRefusal(null);
    void applyGeometry(intent, setRefusal);
  };
  return (
    <Section id="system.belts" title="Belts" count={belts.length}>
      <div className="edit-grid">
        {inner !== null && (
          <EditRow label="Inner radius">
            {editing.innerRadius ? (
              <TextField
                kind="number"
                label="Inner radius"
                title={`The system view draws the hyperlane exits on this circle. It can't go below ${Math.ceil(editing.innerFloor)}.`}
                value={rounded(layout.innerRadius)}
                onCommit={(radius) => send({ kind: "innerRadius", system, radius })}
              />
            ) : (
              rounded(inner)
            )}
          </EditRow>
        )}
        {belts.map((belt, index) =>
          editing.belts ? (
            <BeltRows
              key={index}
              system={system}
              index={index}
              kind={belt.kind}
              radius={belt.radius}
              kinds={kinds}
              send={send}
            />
          ) : (
            <EditRow key={index} label={kindName(belt.kind, kinds)}>
              radius {rounded(belt.radius)}
            </EditRow>
          ),
        )}
        {refusal !== null && (
          <EditNote>
            <span className="warn">{refusal}</span>
          </EditNote>
        )}
      </div>
    </Section>
  );
}
