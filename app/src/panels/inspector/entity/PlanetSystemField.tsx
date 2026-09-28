import { useEffect, useMemo, useState } from "react";
import * as ipc from "../../../api/ipc";
import type { PlanetMoveTargets } from "../../../generated/PlanetMoveTargets";
import type { HistoryView } from "../../../generated/HistoryView";
import {
  jumpsFrom,
  jumpsText,
  nearestFirst,
  refusalLine,
  warningLine,
  warningLines,
} from "../../../lib/planetMove";
import { useEditorStore } from "../../../store/editorStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { usePlanetMoveStore } from "../../../store/planetMoveStore";
import { ComboField, type ComboItem } from "../../ComboField";
import { EditRow } from "../../EditField";
import { useWarningNames } from "../../usePlanetMove";

/** What the field says while the core is asked where the planet may go. */
export const READING_TARGETS = "Reading where this planet can move…";

/** Where planet `id` may move, asked again after every edit, undo and redo; null while on its way. */
function usePlanetTargets(id: number): PlanetMoveTargets | null {
  const history = useEditorStore((s) => s.history);
  const [answer, setAnswer] = useState<{
    id: number;
    history: HistoryView;
    targets: PlanetMoveTargets;
  } | null>(null);
  useEffect(() => {
    let live = true;
    ipc
      .planetMoveTargets([id])
      .then((targets) => {
        if (live) setAnswer({ id, history, targets });
      })
      .catch((e: unknown) => console.warn("planet move targets", ipc.errorMessage(e)));
    return () => {
      live = false;
    };
  }, [id, history]);
  return answer !== null && answer.id === id && answer.history === history ? answer.targets : null;
}

/** A warning line and every warning behind it, for under the field. */
interface Note {
  line: string;
  all: string;
}

/**
 * The System field: planet `id`, standing in `system`, moved to another system picked by name,
 * nearest first. Each row names the owner, with a mark where the game would hand something over.
 */
export function PlanetSystemField({ id, system }: { id: number; system: number }) {
  const targets = usePlanetTargets(id);
  return <SystemChoice id={id} system={system} targets={targets} />;
}

/** The field for `targets` as they were read, null while they are asked for. */
export function SystemChoice({
  id,
  system,
  targets,
}: {
  id: number;
  system: number;
  targets: PlanetMoveTargets | null;
}) {
  const systems = useGalaxyStore((s) => s.systems);
  const systemName = useGalaxyStore((s) => s.systemName);
  const countryName = useGalaxyStore((s) => s.countryName);
  const move = usePlanetMoveStore((s) => s.move);
  const names = useWarningNames();
  const [picked, setPicked] = useState<Note | null>(null);

  const jumps = useMemo(() => jumpsFrom(systems, system), [systems, system]);
  const order = useMemo(() => {
    const here = systems.get(system);
    const distance = (to: number) => {
      const there = systems.get(to);
      return here === undefined || there === undefined
        ? Number.POSITIVE_INFINITY
        : Math.hypot(there.x - here.x, there.y - here.y);
    };
    return nearestFirst(targets?.systems.map((t) => t.system) ?? [], jumps, distance);
  }, [targets, systems, system, jumps]);

  const byId = new Map(targets?.systems.map((t) => [t.system, t]) ?? []);
  const noteOf = (to: number): Note | null => {
    const warnings = byId.get(to)?.warnings ?? [];
    const line = warningLine(warnings, names);
    return line === null ? null : { line, all: warningLines(warnings, names).join("\n") };
  };
  const items: ComboItem[] = order.map((to) => {
    const owner = systems.get(to)?.owner ?? null;
    const warned = (byId.get(to)?.warnings.length ?? 0) > 0;
    const hops = jumps.get(to);
    return {
      key: String(to),
      label: systemName(to),
      detail: (
        <>
          {warned && <span className="warn">⚠ </span>}
          {owner === null ? "no owner" : countryName(owner)}
        </>
      ),
      aside: hops === undefined ? undefined : jumpsText(hops),
    };
  });

  const refusal = targets === null ? null : refusalLine(targets.refused);
  const disabledReason = targets === null ? READING_TARGETS : (refusal ?? undefined);
  const note = (active: ComboItem | null) => {
    const shown = active === null ? picked : noteOf(Number(active.key));
    return shown === null ? null : <span title={shown.all}>⚠ {shown.line}</span>;
  };
  return (
    <EditRow label="System">
      <ComboField
        label="System"
        value={systemName(system)}
        items={items}
        disabledReason={disabledReason}
        title="Type to find a system to move this planet to"
        more="Type to find more…"
        empty="No system matches"
        note={note}
        onPick={(key) => {
          const to = Number(key);
          const warned = noteOf(to);
          setPicked(null);
          void move([id], to).then((moved) => {
            if (moved) setPicked(warned);
          });
        }}
      />
    </EditRow>
  );
}
