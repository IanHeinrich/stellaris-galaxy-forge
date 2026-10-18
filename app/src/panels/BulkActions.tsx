import { clanMenuItem, nextFreeClan } from "../lib/marauder";
import { useWormholePairAction } from "../store/bypassSelectors";
import { useEditorStore } from "../store/editorStore";
import { useGalaxyStore } from "../store/galaxyStore";
import { useArrange } from "./useSelectionActions";
import "./panels.css";

/** What a bulk button shares: closing a hosting menu first, and its role there. */
export interface BulkHost {
  dismiss?: () => void;
  itemRole?: "menuitem";
}

/** One bulk action labelled with how many things it changes, off when that is none. */
export function CountedButton({
  label,
  count,
  run,
  refusal = null,
  className,
  dismiss,
  itemRole,
}: BulkHost & {
  label: string;
  count: number;
  run: () => unknown;
  refusal?: string | null;
  className?: string;
}) {
  return (
    <button
      type="button"
      role={itemRole}
      className={className}
      disabled={count === 0 || refusal !== null}
      title={refusal ?? undefined}
      onClick={() => {
        dismiss?.();
        void run();
      }}
    >
      {label} ({count})
    </button>
  );
}

/** The Shape tool opened on the selection, where the bar mode offers it; off under symmetry, with the reason. */
export function ArrangeButton({
  ids,
  label,
  className,
  dismiss,
  itemRole,
}: BulkHost & { ids: readonly number[]; label: string; className?: string }) {
  const arrange = useArrange(ids);
  if (arrange === null) return null;
  return (
    <button
      type="button"
      role={itemRole}
      className={className}
      disabled={arrange.refusal !== null}
      title={arrange.refusal ?? undefined}
      onClick={() => {
        dismiss?.();
        arrange.run();
      }}
    >
      {label}
    </button>
  );
}

/** Three selected systems on a scenario: made the next free marauder clan, the middle one its home. */
export function MarauderClanButton({
  ids,
  className,
  dismiss,
  itemRole,
}: BulkHost & { ids: readonly number[]; className?: string }) {
  const makeMarauderClan = useEditorStore((s) => s.makeMarauderClan);
  const systems = useGalaxyStore((s) => s.systems);
  const item = clanMenuItem(ids, systems, nextFreeClan(systems));
  return (
    <button
      type="button"
      role={itemRole}
      className={className === undefined ? "hinted" : `hinted ${className}`}
      disabled={item.clan === null}
      title={item.hint}
      onClick={() => {
        dismiss?.();
        if (item.clan !== null) void makeMarauderClan(item.clan.home, item.clan.bases);
      }}
    >
      {item.label}
      <span className="muted">{item.hint}</span>
    </button>
  );
}

/**
 * Two selected systems where the document pairs wormholes: made a wormhole pair, or parted
 * again. In a save it is hidden when either system holds a natural wormhole or shroud tunnel
 * that does not join the two.
 */
export function WormholePairButton({
  a,
  b,
  className,
  dismiss,
  itemRole,
}: BulkHost & { a: number; b: number; className?: string }) {
  const linkWormholePair = useEditorStore((s) => s.linkWormholePair);
  const unlinkWormholePair = useEditorStore((s) => s.unlinkWormholePair);
  const action = useWormholePairAction(a, b);
  if (action === null) return null;
  const run = action === "link" ? linkWormholePair : unlinkWormholePair;
  return (
    <button
      type="button"
      role={itemRole}
      className={className}
      onClick={() => {
        dismiss?.();
        void run(a, b);
      }}
    >
      {action === "link" ? "Link as wormhole pair" : "Unlink wormhole pair"}
    </button>
  );
}
