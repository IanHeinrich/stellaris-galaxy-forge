import { useEffect, useMemo, useState } from "react";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { SystemDetails } from "../../../generated/SystemDetails";
import { selectedBody, type SelectedBody } from "../../../lib/details/bodiesEdit";
import { bodyName } from "../../../lib/details/labels";
import { lastOf } from "../../../lib/memo";
import { useDetailsStore } from "../../../store/detailsStore";
import { useEntityStore } from "../../../store/entityStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { bodiesStale } from "../../../store/planetEditAdapter";
import { usePlanetDataStore, type PlanetDataKeys } from "../../../store/planetDataStore";
import type { BodySelection } from "../../../store/sceneStore";
import type { BodyAnswer, Listed } from "../entity/bodySources";

/** A selected body its system's details list, as a body's source is handed it. */
export interface ListedBody {
  id: number;
  listed: Listed;
}

/** The selected bodies in order, and those of them the system's details list. */
export interface SelectionListing {
  entries: readonly { id: number; summary: PlanetSummary | undefined }[];
  listed: readonly ListedBody[];
}

/** Which selected bodies `read` lists, each as its source takes it; `null` until it is read. */
export function useSelectionListing(
  selection: BodySelection,
  read: SystemDetails | undefined,
): SelectionListing | null {
  return useMemo(() => {
    if (read === undefined) return null;
    const entries = selection.ids.map((id) => ({
      id,
      summary: read.planets.find((p) => p.id === id),
    }));
    const listed = entries.flatMap(({ id, summary }) =>
      summary === undefined ? [] : [{ id, listed: { details: read, summary } }],
    );
    return { entries, listed };
  }, [selection.ids, read]);
}

/** The selected bodies that read, and the names of those whose page or listing couldn't be read. */
export interface ReadBodies {
  bodies: SelectedBody[];
  unread: string[];
}

/** What an answer holds that changes only when its body reads differently. */
function answerParts(answer: BodyAnswer): readonly unknown[] {
  if ("read" in answer) return [answer.read.summary, answer.read.rows, answer.read.target];
  return ["waiting" in answer ? answer.waiting : "generic"];
}

/** Asks for the game data the rows show: every deposit and modifier the answers name. */
function usePlanetData(answers: readonly BodyAnswer[]): void {
  const generation = usePlanetDataStore((s) => s.generation);
  const [memo] = useState(() => lastOf<PlanetDataKeys[]>());
  const keys = memo(
    answers.map((a) => ("read" in a ? a.read.dataKeys : null)),
    () => answers.flatMap((a) => ("read" in a ? [a.read.dataKeys] : [])),
  );
  useEffect(() => {
    usePlanetDataStore.getState().request({
      deposits: keys.flatMap((k) => k.deposits),
      modifiers: keys.flatMap((k) => k.modifiers),
      colonyTypes: [],
      anomalies: [],
      digSites: [],
    });
  }, [keys, generation]);
}

/**
 * The selected bodies as their sources answered `answers`, one for each body `listing` lists;
 * `null` while one is still being read. A body whose read was refused, or that the system's
 * details don't list, is named in `unread` instead.
 */
export function useSelectedBodies(
  listing: SelectionListing,
  answers: readonly BodyAnswer[],
  read: SystemDetails,
): ReadBodies | null {
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const names = useGameDataStore((s) => s.names);
  const [memo] = useState(() => lastOf<ReadBodies | null>());
  usePlanetData(answers);
  return memo(
    [listing, read, planetClasses, starClasses, names, ...answers.flatMap(answerParts)],
    () => {
      const megastructures = new Set(read.megastructures.flatMap((m) => m.planet ?? []));
      const facts = { planetClasses, starClasses, megastructures };
      const answerOf = new Map(listing.listed.map(({ id }, i) => [id, answers[i]]));
      const bodies: SelectedBody[] = [];
      const unread: string[] = [];
      for (const { id, summary } of listing.entries) {
        const answer = answerOf.get(id);
        const name = summary === undefined ? `#${id}` : bodyName(summary, names);
        if (answer === undefined || "generic" in answer) unread.push(name);
        else if ("waiting" in answer) return null;
        else {
          const { summary: body, rows, target } = answer.read;
          bodies.push(selectedBody({ summary: body, rows, held: target }, name, facts));
        }
      }
      return { bodies, unread };
    },
  );
}

/** Whether an edit has left any selected body's page or the system's details to be read again. */
export function useStale(selection: BodySelection): boolean {
  const entityVersion = useEntityStore((s) => s.version);
  const details = useDetailsStore((s) => s.stale);
  return useMemo(
    () => bodiesStale(selection.system, selection.ids),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again whenever either store moves
    [selection, entityVersion, details],
  );
}
