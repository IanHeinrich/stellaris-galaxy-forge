import { confirm } from "@tauri-apps/plugin-dialog";
import * as ipc from "../api/ipc";
import { useFileSessionStore } from "./fileSessionStore";
import { useInspectorStore, type Entry, type GonePages } from "./inspectorStore";

/** A failed read that knows which part it was: `stem` is the sentence the session error opens with. */
export class Unreadable extends Error {
  constructor(
    readonly stem: string,
    readonly reason: unknown,
  ) {
    super(stem);
  }
}

/**
 * Reads what a deletion takes, asks the user, applies it, and closes the inspector's pages on
 * what went. It answers whether the deletion was applied. A `read` that fails shows `unreadable`
 * with the reason and deletes nothing, and a `question` of null means there is nothing to delete.
 */
export async function confirmDeletion<Loss>(deletion: {
  title: string;
  /** The session error's opening when `read` fails without saying which part, such as "Couldn't read Terra, so nothing was deleted". */
  unreadable: string;
  read: () => Promise<Loss>;
  question: (loss: Loss) => string | null;
  apply: () => Promise<boolean>;
  gone: (loss: Loss) => GonePages;
  /** Where a stack rooted on a page that went restarts; the Galaxy page when left out. */
  root?: Entry;
}): Promise<boolean> {
  let loss: Loss;
  try {
    loss = await deletion.read();
  } catch (e) {
    const stem = e instanceof Unreadable ? e.stem : deletion.unreadable;
    const why = ipc.errorMessage(e instanceof Unreadable ? e.reason : e);
    useFileSessionStore.getState().setError(`${stem}: ${why}`);
    return false;
  }
  const question = deletion.question(loss);
  if (question === null) return false;
  if (!(await confirm(question, { title: deletion.title, kind: "warning" }))) return false;
  if (!(await deletion.apply())) return false;
  useInspectorStore.getState().dropPages(deletion.gone(loss), deletion.root);
  return true;
}
