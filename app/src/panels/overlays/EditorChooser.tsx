import { useState, type FormEvent } from "react";
import type { EditorChoices } from "../../generated/EditorChoices";
import type { EditorPick } from "../../generated/EditorPick";
import {
  ARGS_HINT,
  NO_PROGRAM,
  CHOOSER_TITLE,
  OTHER_EDITOR,
  REMEMBER_CHOICE,
  STEAM_REPLACES,
  SYSTEM_DEFAULT,
} from "../../lib/editorCopy";
import { fileName } from "../../lib/paths";
import {
  useScriptEditorStore,
  type EditorChoice,
  type OpenTarget,
} from "../../store/scriptEditorStore";
import { Dialog } from "../Dialog";
import "./overlays.css";

const SYSTEM = "system_default";
const OTHER = "other";

/** The radio a pick selects: a found editor's id, or one of the two that are always offered. */
function keyOf(pick: EditorPick): string {
  return pick.kind === "found" ? `found:${pick.id}` : pick.kind;
}

/** The radio selected when the chooser opens: the last pick while it is still offered, else the first editor found. */
function firstKey(choices: EditorChoices, last: EditorChoice | null): string {
  const keys = [...choices.editors.map((e) => `found:${e.id}`), SYSTEM, OTHER];
  const lastKey = last === null ? null : keyOf(last.pick);
  return lastKey !== null && keys.includes(lastKey) ? lastKey : keys[0];
}

/** The chooser, while the store has it open. */
export function EditorChooser() {
  const chooser = useScriptEditorStore((s) => s.chooser);
  const choices = useScriptEditorStore((s) => s.choices);
  const last = useScriptEditorStore((s) => s.choice);
  const choose = useScriptEditorStore((s) => s.choose);
  const cancel = useScriptEditorStore((s) => s.cancel);
  const pickProgram = useScriptEditorStore((s) => s.pickProgram);
  if (chooser === null) return null;
  return (
    <Dialog className="notice-dialog" label={CHOOSER_TITLE} onClose={cancel} onDismiss={cancel}>
      {choices === null ? (
        <>
          <h1>{CHOOSER_TITLE}</h1>
          <p className="muted">Looking for editors…</p>
        </>
      ) : (
        <ChooserBody
          target={chooser.target}
          choices={choices}
          last={last}
          onChoose={(pick, name, remember) => void choose(pick, name, remember)}
          onBrowse={() => void pickProgram()}
          onCancel={cancel}
        />
      )}
    </Dialog>
  );
}

export interface ChooserBodyProps {
  /** The file it opens; null when it changes the setting from the Help menu. */
  target: OpenTarget | null;
  choices: EditorChoices;
  last: EditorChoice | null;
  onChoose(pick: EditorPick, name: string | null, remember: boolean): void;
  /** Has the shell ask for the program Other… opens files with. */
  onBrowse(): void;
  onCancel(): void;
}

/**
 * The editors found, most used by modders first, then the system default and the program the
 * user picked in the shell's file dialog, with the checkbox that keeps the pick: ticked unless the
 * last pick was not kept.
 */
export function ChooserBody({
  target,
  choices,
  last,
  onChoose,
  onBrowse,
  onCancel,
}: ChooserBodyProps) {
  const [selected, setSelected] = useState(() => firstKey(choices, last));
  const [args, setArgs] = useState(last?.pick.kind === "other" ? last.pick.args : "{file}");
  const [remember, setRemember] = useState(last?.remember ?? true);
  const other = selected === OTHER;
  const program = choices.other;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (other) {
      if (program !== null) onChoose({ kind: "other", args }, program, remember);
      return;
    }
    if (selected === SYSTEM) {
      onChoose({ kind: "system_default" }, null, remember);
      return;
    }
    const editor = choices.editors.find((e) => `found:${e.id}` === selected);
    if (editor) onChoose({ kind: "found", id: editor.id }, editor.name, remember);
  };

  const radio = (key: string, label: string) => (
    <label key={key} className="editor-chooser-row">
      <input
        type="radio"
        name="editor"
        checked={selected === key}
        onChange={() => setSelected(key)}
      />
      <span>{label}</span>
    </label>
  );

  return (
    <form className="editor-chooser" onSubmit={submit}>
      <h1>{CHOOSER_TITLE}</h1>
      {target !== null && (
        <p className="muted">
          {fileName(target.file)}
          {target.line == null ? "" : `, line ${target.line}`}
        </p>
      )}
      {choices.steam_replaces && <p className="warn">{STEAM_REPLACES}</p>}
      <div role="radiogroup" aria-label="Editors" className="editor-chooser-list">
        {choices.editors.map((e) => radio(`found:${e.id}`, e.name))}
        {radio(SYSTEM, SYSTEM_DEFAULT)}
        {radio(OTHER, OTHER_EDITOR)}
      </div>
      {other && (
        <div className="editor-chooser-other">
          <span className="editor-chooser-program">
            <span className={program === null ? "muted" : undefined}>{program ?? NO_PROGRAM}</span>
            <button type="button" onClick={onBrowse}>
              Browse…
            </button>
          </span>
          <label>
            <span>Arguments</span>
            <input
              type="text"
              value={args}
              spellCheck={false}
              onChange={(e) => setArgs(e.currentTarget.value)}
            />
          </label>
          <span className="muted">{ARGS_HINT}</span>
        </div>
      )}
      <label className="editor-chooser-row">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.currentTarget.checked)}
        />
        <span>{REMEMBER_CHOICE}</span>
      </label>
      <div className="notice-actions">
        <button type="submit" autoFocus disabled={other && program === null}>
          {target === null ? "Save" : "Open"}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
