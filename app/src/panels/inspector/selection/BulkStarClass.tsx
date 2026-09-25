import { useEffect, useMemo, useState } from "react";
import {
  bulkStarClassChoices,
  currentStarBodies,
  planStarClass,
  skippedNote,
  STARS_NEED_GAME_DATA,
  type StarClassTarget,
} from "../../../lib/details/starClass";
import { counted } from "../../../lib/text";
import { useDetailsStore } from "../../../store/detailsStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { PickerField } from "../../EditField";
import { useApplyOp } from "../../useApplyOp";
import { useStarClassItems } from "../useStarClassItems";

/** Above this many selected systems the star class action reads no details and says so. */
const STAR_CLASS_COUNT_MAX = 1000;

/**
 * Several save systems selected: one star class for every one with as many stars, as one edit,
 * and a note of the systems it left alone. Their details are read, for their star bodies, only
 * once the picker is opened, and not at all above `STAR_CLASS_COUNT_MAX` systems.
 */
export function BulkStarClass({ ids }: { ids: readonly number[] }) {
  const applyOp = useApplyOp();
  const request = useDetailsStore((s) => s.request);
  const version = useDetailsStore((s) => s.version);
  const details = useDetailsStore((s) => s.details);
  const pending = useDetailsStore((s) => s.pending);
  const failed = useDetailsStore((s) => s.failed);
  const stale = useDetailsStore((s) => s.stale);
  const systems = useGalaxyStore((s) => s.systems);
  const gameData = useGameDataStore((s) => s.status === "ready");
  const names = useGameDataStore((s) => s.names);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const [openedFor, setOpenedFor] = useState<readonly number[] | null>(null);
  const [note, setNote] = useState<{ ids: readonly number[]; text: string | null } | null>(null);
  const opened = openedFor === ids;

  // Asked again after each edit, for the systems it left stale.
  useEffect(() => {
    if (gameData && opened) request(ids);
  }, [gameData, opened, ids, request, version]);

  const targets = useMemo(
    () =>
      opened
        ? ids.flatMap((id): StarClassTarget[] => {
            const system = systems.get(id);
            if (!system) return [];
            const read = details.get(id);
            const bodies = currentStarBodies(read, stale.has(id), planetClasses, starClasses);
            return [{ system, bodies }];
          })
        : [],
    [opened, ids, systems, details, stale, planetClasses, starClasses],
  );
  const choices = bulkStarClassChoices(targets, starClasses);
  const items = useStarClassItems(choices);

  const label = `Star class… (${counted(ids.length, "system")})`;
  const tooMany = ids.length > STAR_CLASS_COUNT_MAX;
  if (!gameData || tooMany) {
    return (
      <PickerField
        label="Star class"
        disabledReason={
          tooMany ? `Limited to ${STAR_CLASS_COUNT_MAX} systems` : STARS_NEED_GAME_DATA
        }
        current={{ key: "", label }}
        items={[]}
        onPick={() => undefined}
      />
    );
  }
  const waiting = targets.filter((t) => t.bodies === null && !failed.has(t.system.id));
  const loading =
    waiting.some((t) => pending.has(t.system.id)) ||
    (waiting.length > 0 && waiting.length === targets.length);

  const open = () => {
    setOpenedFor(ids);
    request(ids);
  };
  const pick = (key: string) => {
    const target = starClasses.get(key);
    if (!target) return;
    const name = names.get(key) ?? key;
    const plan = planStarClass(targets, target, name, starClasses);
    if (plan.op) applyOp(plan.op);
    setNote({ ids, text: skippedNote(plan.skipped, name) });
  };
  return (
    <>
      <PickerField
        label="Star class"
        title="Change the star class of the selected systems with as many stars"
        current={{ key: "", label: loading ? "Star class… (loading…)" : label }}
        items={loading ? [] : items}
        empty={loading ? "Reading the systems' stars…" : "No star class fits these systems"}
        onOpen={open}
        onPick={pick}
      />
      {note?.ids === ids && note.text !== null && <div className="muted ins-hint">{note.text}</div>}
    </>
  );
}
