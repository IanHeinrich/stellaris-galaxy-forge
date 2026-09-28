import type { OrbitPlacement } from "../../../generated/OrbitPlacement";
import {
  cutLabel,
  movingBodies,
  pasteLabel,
  warningLine,
  warningLines,
} from "../../../lib/planetMove";
import { useDetailsStore } from "../../../store/detailsStore";
import { cutAvailability, usePasteCheck, usePlanetMoveStore } from "../../../store/planetMoveStore";
import { useCut, useWarningNames } from "../../usePlanetMove";
import { MenuItem } from "./MenuItem";

/**
 * Paste, while planets are cut: a lone planet at `at` where given, a group into the next free
 * orbits. A refused paste stays, disabled, with the refusal on hover; a warned one says the first
 * warning under its label and lists them all on hover.
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
  const cut = useCut();
  const paste = usePlanetMoveStore((s) => s.paste);
  const place = cut?.count === 1 ? (at ?? null) : null;
  const check = usePasteCheck(system, place);
  const names = useWarningNames();
  if (cut === null) return null;
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
      run={() => paste(system, place)}
    >
      {pasteLabel(cut.planets, place)}
      {line !== null && <span className="warn">⚠ {line}</span>}
    </MenuItem>
  );
}

/**
 * Cut, on a body of the selection. It stays disabled while the core is asked where the selection
 * may go, and says why when the core refuses it.
 */
export function CutItem({ system }: { system: number }) {
  const selection = usePlanetMoveStore((s) => s.selection);
  const selectionTargets = usePlanetMoveStore((s) => s.selectionTargets);
  const cutSelection = usePlanetMoveStore((s) => s.cutSelection);
  const read = useDetailsStore((s) => s.details.get(system));
  const availability = cutAvailability({ selection, selectionTargets });
  if (availability.kind === "none" || selection === null) return null;
  const moving =
    availability.kind === "ready"
      ? availability.planets.length
      : movingBodies(
          selection.ids,
          (id) => read?.planets.find((p) => p.id === id)?.parent ?? null,
        ).length;
  return (
    <MenuItem
      disabled={availability.kind !== "ready"}
      title={availability.kind === "refused" ? availability.reason : undefined}
      run={cutSelection}
    >
      {cutLabel(moving)}
    </MenuItem>
  );
}
