import { confirm } from "@tauri-apps/plugin-dialog";
import { nodeName } from "../../lib/names";
import { useEditorStore } from "../../store/editorStore";
import { useGalaxyStore } from "../../store/galaxyStore";

/** The radius field's id, so the map's menu can send the user straight to it. */
export const NEBULA_RADIUS_INPUT_ID = "nebula-radius";

export function systemCount(count: number): string {
  return `${count} system${count === 1 ? "" : "s"}`;
}

/** The name a nebula goes by; the only other one it has is its place in the file. */
export function nebulaLabel(index: number): string {
  const nebula = useGalaxyStore.getState().nebulae[index];
  return nebula ? nodeName(nebula.name) : `Nebula ${index}`;
}

/** Removes the nebula once the user has agreed to what leaves with it. */
export async function confirmRemoveNebula(index: number): Promise<void> {
  const nebula = useGalaxyStore.getState().nebulae[index];
  if (!nebula) return;
  const name = nodeName(nebula.name);
  const question = `Delete ${name}? ${systemCount(nebula.systems.length)} will leave it.`;
  if (!(await confirm(question, { title: name, kind: "warning" }))) return;
  await useEditorStore.getState().removeNebula(index);
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
