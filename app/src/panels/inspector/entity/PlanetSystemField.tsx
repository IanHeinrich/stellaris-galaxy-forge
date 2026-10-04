import { useMemo } from "react";
import type { PlanetMoveWarning } from "../../../generated/PlanetMoveWarning";
import {
  jumpsFrom,
  jumpsText,
  nearestFirst,
  refusalLine,
  warningLine,
  warningLines,
} from "../../../lib/planetMove";
import { useGalaxyStore } from "../../../store/galaxyStore";
import {
  usePlanetMoveStore,
  usePlanetTargets,
  type TargetsRead,
} from "../../../store/planetMoveStore";
import { ComboField, type ComboItem } from "../../ComboField";
import { EditRow } from "../../EditField";
import { useWarningNames } from "../../usePlanetMove";

/** What the field says while the core is first asked where the planet may go. */
export const READING_TARGETS = "Reading where this planet can move…";

/** What the field says when the core could not say where the planet may go. */
export const TARGETS_FAILED = "Couldn't read where this planet can move";

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
  const read = usePlanetTargets(id);
  return <SystemChoice id={id} system={system} read={read} />;
}

/** The field for the targets as they were `read`, null while they are first asked for. */
export function SystemChoice({
  id,
  system,
  read,
}: {
  id: number;
  system: number;
  read: TargetsRead | null;
}) {
  const targets = read !== null && "targets" in read ? read.targets : null;
  const systems = useGalaxyStore((s) => s.systems);
  const systemName = useGalaxyStore((s) => s.systemName);
  const countryName = useGalaxyStore((s) => s.countryName);
  const movePlanet = usePlanetMoveStore((s) => s.movePlanet);
  const names = useWarningNames();
  const moved = usePlanetMoveStore((s) => (s.lastMove?.planet === id ? s.lastMove.warnings : null));

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
  const noteOn = (warnings: readonly PlanetMoveWarning[]): Note | null => {
    const line = warningLine(warnings, names);
    return line === null ? null : { line, all: warningLines(warnings, names).join("\n") };
  };
  const noteOf = (to: number) => noteOn(byId.get(to)?.warnings ?? []);
  const picked = moved === null ? null : noteOn(moved);
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
  const disabledReason =
    read === null ? READING_TARGETS : targets === null ? TARGETS_FAILED : (refusal ?? undefined);
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
          void movePlanet(id, to, byId.get(to)?.warnings ?? []);
        }}
      />
    </EditRow>
  );
}
