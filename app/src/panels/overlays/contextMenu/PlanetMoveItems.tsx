import type { OrbitPlacement } from "../../../generated/OrbitPlacement";
import { documentCapabilities } from "../../../lib/capabilities";
import { shortcutLabel } from "../../../lib/keys";
import {
  alreadyThere,
  copyLabel,
  cutLabel,
  movingBodies,
  pasteLabel,
  warningLine,
  warningLines,
} from "../../../lib/planetMove";
import { useDetailsStore } from "../../../store/detailsStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import {
  cutAvailability,
  cutPlanets,
  usePasteCheck,
  usePlanetMoveStore,
} from "../../../store/planetMoveStore";
import { useSceneStore } from "../../../store/sceneStore";
import { useClipboard, useMovedPlanets, useWarningNames } from "../../useCut";
import { MenuItem } from "./MenuItem";

const CUT_KEY = shortcutLabel("cutPlanets");
const COPY_KEY = shortcutLabel("copyPlanets");
const PASTE_KEY = shortcutLabel("pastePlanets");

/**
 * Paste, while planets are cut or copied: a copy, or a lone cut planet, at `at` where given, and
 * a cut group into the next free orbits. A refused paste of a cut stays, disabled, with the refusal on hover; a warned
 * one says the first warning under its label and lists them all on hover. The cut planets' own
 * system is refused without asking the core. A copy pastes into any system, its own included.
 */
export function PasteItem({
  system,
  at,
  className,
}: {
  system: number;
  at?: OrbitPlacement | null;
  className?: string;
}) {
  const clipboard = useClipboard();
  const paste = usePlanetMoveStore((s) => s.paste);
  if (clipboard === null) return null;
  const place = clipboard.kind === "copy" || clipboard.count === 1 ? (at ?? null) : null;
  const label = pasteLabel(clipboard.planets, place);
  if (clipboard.kind === "copy") {
    return (
      <MenuItem className={className} shortcut={PASTE_KEY} run={() => paste(system, place)}>
        {label}
      </MenuItem>
    );
  }
  if (clipboard.fromId === system) {
    return (
      <MenuItem
        className={className}
        disabled
        title={alreadyThere(clipboard.planets, clipboard.from)}
        shortcut={PASTE_KEY}
        run={() => undefined}
      >
        {label}
      </MenuItem>
    );
  }
  return <CheckedPaste system={system} place={place} label={label} className={className} />;
}

/** Paste into another system, with what the core says a paste there meets. */
function CheckedPaste({
  system,
  place,
  label,
  className,
}: {
  system: number;
  place: OrbitPlacement | null;
  label: string;
  className?: string;
}) {
  const paste = usePlanetMoveStore((s) => s.paste);
  const check = usePasteCheck(system, place);
  const names = useWarningNames();
  const refusal = check?.refusal ?? null;
  const warnings = refusal === null ? (check?.warnings ?? []) : [];
  const line = warningLine(warnings, names);
  const classes = [className, line !== null && "hinted"].filter(Boolean).join(" ");
  return (
    <MenuItem
      className={classes === "" ? undefined : classes}
      disabled={check === null || refusal !== null}
      title={
        refusal ?? (warnings.length > 0 ? warningLines(warnings, names).join("\n") : undefined)
      }
      shortcut={PASTE_KEY}
      run={() => paste(system, place)}
    >
      {label}
      {line !== null && <span className="warn">⚠ {line}</span>}
    </MenuItem>
  );
}

/**
 * Cut, on a body of the selection. It stays disabled while the core is asked where the selection
 * may go, and says why when the core refuses it.
 */
export function CutItem({ system }: { system: number }) {
  const selection = useSceneStore((s) => s.bodySelection);
  const selectionTargets = usePlanetMoveStore((s) => s.selectionTargets);
  const cutSelection = usePlanetMoveStore((s) => s.cutSelection);
  const read = useDetailsStore((s) => s.details.get(system));
  const availability = cutAvailability(selection, selectionTargets);
  const planets = useMovedPlanets(cutPlanets(selection, selectionTargets, read));
  if (availability.kind === "none" || selection === null) return null;
  return (
    <MenuItem
      disabled={availability.kind !== "ready"}
      title={availability.kind === "refused" ? availability.reason : undefined}
      shortcut={CUT_KEY}
      run={cutSelection}
    >
      {cutLabel(planets)}
    </MenuItem>
  );
}

/** Copy, on a body of the selection, on a document that takes new bodies. */
export function CopyItem({ system }: { system: number }) {
  const selection = useSceneStore((s) => s.bodySelection);
  const copySelection = usePlanetMoveStore((s) => s.copySelection);
  const read = useDetailsStore((s) => s.details.get(system));
  const copies = useFileSessionStore((s) => documentCapabilities(s).add_bodies);
  const parentOf = (id: number) => read?.planets.find((p) => p.id === id)?.parent ?? null;
  const planets = useMovedPlanets(movingBodies(selection?.ids ?? [], parentOf));
  if (!copies || selection === null) return null;
  return (
    <MenuItem shortcut={COPY_KEY} run={copySelection}>
      {copyLabel(planets)}
    </MenuItem>
  );
}
