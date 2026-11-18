import { megastructureMove } from "../../../lib/details/megastructureMoves";
import { systemOfMegastructure } from "../../../lib/details/megastructureRemoval";
import { megastructureFieldIntent, type PositionField } from "../../../lib/details/orbitIntent";
import { useDetailsStore } from "../../../store/detailsStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useSystemGeometry } from "../../../store/systemGeometry";
import { useGeometryEdit } from "../useGeometryEdit";
import { PositionBlock } from "./PositionBlock";

const CENTRE = { x: 0, y: 0 };

/**
 * The Position block of megastructure `id`, where it stands at a point of its own about the
 * system's centre and the document moves it there; nothing for any other row. Each commit is the
 * move a drag in the system view sends.
 */
export function MegastructurePosition({ id }: { id: number }) {
  const system = useDetailsStore((s) => systemOfMegastructure(s.details, id));
  const { frame, editing } = useSystemGeometry(system);
  const types = useGameDataStore((s) => s.megastructureTypes);
  const { send, note } = useGeometryEdit(system ?? 0);
  const row = frame.details?.megastructures.find((m) => m.id === id);
  if (system === null || row?.at == null || !editing.megastructures) return null;
  if (megastructureMove(row, types.get(row.kind)).place !== "free") return null;
  const commit = (field: PositionField, typed: number) =>
    send(({ frame: now }) => {
      const current = now.details?.megastructures.find((m) => m.id === id);
      return current ? megastructureFieldIntent(system, current, field, typed) : null;
    });
  const [x, y] = row.at;
  return (
    <PositionBlock centre={CENTRE} at={{ x, y }} about="the system's centre" onCommit={commit}>
      {note()}
    </PositionBlock>
  );
}
