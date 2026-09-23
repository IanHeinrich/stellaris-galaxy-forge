import { nodeName } from "../../lib/names";
import { counted } from "../../lib/text";
import { useEditorStore } from "../../store/editorStore";
import { useGalaxyStore } from "../../store/galaxyStore";

/** The radius field's id, so the map's menu can send the user straight to it. */
export const NEBULA_RADIUS_INPUT_ID = "nebula-radius";

export function systemCount(count: number): string {
  return counted(count, "system");
}

/** The name a nebula goes by; the only other one it has is its place in the file. */
export function nebulaLabel(index: number): string {
  const nebula = useGalaxyStore.getState().nebulae[index];
  return nebula ? nodeName(nebula.name) : `Nebula ${index}`;
}

/** Removes the nebula once the user has agreed to what leaves with it. */
export function confirmRemoveNebula(index: number): Promise<void> {
  return useEditorStore.getState().removeNebula(index);
}

/** Puts the caret in the radius field, once the inspector has drawn the nebula it belongs to. */
export function focusNebulaRadius(): void {
  requestAnimationFrame(() => {
    const field = document.getElementById(NEBULA_RADIUS_INPUT_ID);
    if (field instanceof HTMLInputElement) {
      field.focus();
      field.select();
    }
  });
}
