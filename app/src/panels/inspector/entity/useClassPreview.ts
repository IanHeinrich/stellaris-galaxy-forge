import { useEffect, useMemo } from "react";
import type { ClassRolls } from "../../../generated/ClassRolls";
import { offeredAsks } from "../../../lib/details/spawnFacts";
import { classRollsKey, useClassRollsStore } from "../../../store/classRollsStore";
import { classPickKey, useInspectorStore } from "../../../store/inspectorStore";
import { summaryDataKeys, type BodyRead } from "./bodySources";
import { useClassList } from "./useClassList";

/** The class picked in a body page's class list, and the body as the page shows it. */
export interface ClassPreview {
  /** The class picked, where its class list still offers it; `null` for Any. */
  picked: string | null;
  /** Picks a class, or Any for `null` or the class already picked. */
  pick(className: string | null): void;
  /** The body as that class once what it rolls as it is read, else as it is. */
  read: BodyRead;
  /** What it rolls as the picked class is still being read. */
  busy: boolean;
  /** Why what it rolls as the picked class could not be read. */
  error: string | null;
}

/** `read` with the size, ring, deposits and planet features the body rolls as one class. */
function rolledAs(read: BodyRead, rolls: ClassRolls): BodyRead {
  const { summary } = read;
  const spawn = summary.spawn;
  if (spawn === undefined) return read;
  const shown = {
    ...summary,
    size: null,
    layout: {
      orbit: null,
      at: null,
      orbit_step: null,
      angle_step: null,
      turns_from: null,
      ...summary.layout,
      size: rolls.size,
    },
    spawn: {
      ...spawn,
      ring: rolls.ring,
      rolled_deposits: rolls.deposits,
      rolled_features: rolls.features,
    },
  };
  return { ...read, summary: shown, dataKeys: summaryDataKeys(shown), pickedClass: rolls.class };
}

/** The class picked in body `read`'s class list, and what the body rolls as it. */
export function useClassPreview(read: BodyRead): ClassPreview {
  const system = read.details.id;
  const body = read.summary.id;
  const stored = useInspectorStore((s) => s.classPicks[classPickKey(system, body)] ?? null);
  const list = useClassList(read);
  const offered = offeredAsks(list?.asks ?? []);
  const picked = stored !== null && offered.includes(stored) ? stored : null;
  const key = picked === null ? null : classRollsKey(system, body, picked);
  const answer = useClassRollsStore((s) => (key === null ? undefined : s.answers.get(key)));
  const asked = useClassRollsStore((s) => key !== null && s.pending.has(key));
  const missing = picked !== null && answer === undefined && !asked;
  useEffect(() => {
    if (missing && picked !== null) useClassRollsStore.getState().request(system, body, picked);
  }, [missing, system, body, picked]);
  const rolls = answer !== undefined && "rolls" in answer ? answer.rolls : null;
  const shown = useMemo(() => (rolls === null ? read : rolledAs(read, rolls)), [read, rolls]);
  return {
    picked,
    pick: (className) => useInspectorStore.getState().pickClass(system, body, className),
    read: shown,
    busy: picked !== null && answer === undefined,
    error: answer !== undefined && "error" in answer ? answer.error : null,
  };
}
