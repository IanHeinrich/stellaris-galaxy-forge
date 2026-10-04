import { useState } from "react";
import type { GeometryIntent } from "../../lib/details/orbitIntent";
import { applyGeometryFrom, type SystemGeometry } from "../../store/systemGeometry";
import { EditNote } from "../EditField";

/** An intent, or one built from the system's geometry as it stands when the edit runs. */
export type GeometryEdit = GeometryIntent | ((geometry: SystemGeometry) => GeometryIntent | null);

/**
 * Sends a system's geometry edits and keeps the refusal of the last one. A page with several
 * places for a refusal names the place (`at`) when it sends, and asks `note` for that place.
 */
export function useGeometryEdit<At = never>(system: number) {
  const [refusal, setRefusal] = useState<{ at: At | undefined; text: string } | null>(null);
  return {
    send(edit: GeometryEdit, at?: At) {
      setRefusal(null);
      void applyGeometryFrom(system, typeof edit === "function" ? edit : () => edit, (text) =>
        setRefusal({ at, text }),
      );
    },
    note(at?: At) {
      return (
        refusal !== null &&
        refusal.at === at && (
          <EditNote>
            <span className="warn">{refusal.text}</span>
          </EditNote>
        )
      );
    },
  };
}
