import { useState, type FormEvent } from "react";
import { focusNebulaRadius } from "../inspector/nebula";
import { useEditorStore } from "../../store/editorStore";
import { Dialog } from "./Dialog";

/**
 * The name a new nebula is created with. A cloud is dragged by its label, so it is named
 * before it exists rather than after.
 */
export function NewNebulaDialog() {
  const cancel = useEditorStore((s) => s.cancelNebulaPrompt);
  const create = useEditorStore((s) => s.createPromptedNebula);
  const [name, setName] = useState("");
  const named = name.trim();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (named === "") return;
    void create(named).then((added) => {
      if (added) focusNebulaRadius();
    });
  };

  return (
    <Dialog className="open-dialog" label="New nebula" onClose={cancel} onDismiss={cancel}>
      <form onSubmit={submit}>
        <div className="open-dialog-head">
          <h1>New nebula</h1>
        </div>
        <div className="open-dialog-body">
          <label className="field">
            <span>Name</span>
            <input
              value={name}
              required
              autoFocus
              onChange={(e) => setName(e.currentTarget.value)}
            />
          </label>
          <div className="muted">
            The name is the label the cloud is drawn with, and the handle you drag it by.
          </div>
        </div>
        <div className="open-dialog-foot">
          <div className="setup-actions">
            <button type="button" onClick={cancel}>
              Cancel
            </button>
            <button type="submit" disabled={named === ""}>
              Create
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
