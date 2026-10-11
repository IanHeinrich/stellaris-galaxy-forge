/** Opening and closing the Inspector's groups, as a click on a group's head does. */
import { refKey, useInspectorStore } from "../store/inspectorStore";

/** Opens or closes group `id` on the page the Inspector shows; `folded` is the group's default. */
export function toggleGroup(id: string, folded = true): void {
  const { stack, toggleGroup: toggle } = useInspectorStore.getState();
  toggle(`${id}@${refKey(stack[stack.length - 1].ref)}`, folded);
}

/** Opens each of the folded groups `ids` on the page the Inspector shows. */
export function openGroups(...ids: string[]): void {
  for (const id of ids) toggleGroup(id);
}
