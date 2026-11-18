import { useMemo, useState } from "react";
import type { AmbientObjectView } from "../../generated/AmbientObjectView";
import {
  ambientObjectEntries,
  ambientObjectGroup,
  inGameLines,
  matchingAmbientObjects,
  NO_AMBIENT_OBJECT_MATCHES,
  NO_AMBIENT_OBJECT_TYPES,
  READING_AMBIENT_OBJECTS,
  sharedNameKeys,
} from "../../lib/ambientObjectAdd";
import { aboutMainStar, mainStarPoint } from "../../lib/details/ambientObjects";
import { whereText } from "../../lib/megastructureCopy";
import {
  useAmbientObjectAddStore,
  type AmbientObjectAddPrompt,
} from "../../store/ambientObjectAdd";
import { useSystemNames } from "../../store/browserRows";
import { useSystemGeometry } from "../../store/systemGeometry";
import { GameText } from "../GameText";
import { Icon } from "../parts";
import { useAmbientObjectViews } from "../useAmbientObjectViews";
import { PlaceDialog } from "./PlaceDialog";
import { PortraitList } from "./PortraitList";

/** The Add ambient object browser, while the system view's menu has asked for it. */
export function AddAmbientObjectDialog() {
  const prompt = useAmbientObjectAddStore((s) => s.prompt);
  return prompt === null ? null : <AddAmbientObjectForm prompt={prompt} />;
}

/**
 * The picked object: a larger picture, its name (with its key where another shares the name) and
 * description, what the game does with it and what places it.
 */
function AmbientObjectPreview({ view, keyed }: { view: AmbientObjectView; keyed: boolean }) {
  return (
    <aside className="megastructure-add-preview" aria-label="Selected ambient object">
      {view.portrait === null ? (
        <span className="megastructure-add-picture ambient-object-placeholder" />
      ) : (
        <Icon className="megastructure-add-picture" keys={[view.portrait]} />
      )}
      <h2>{view.name}</h2>
      {keyed && <KeyLine view={view} />}
      {view.description !== null && (
        <p className="megastructure-add-description">
          <GameText text={view.description} />
        </p>
      )}
      <div className="megastructure-add-lines">
        <span className="muted">In game</span>
        <ul>
          {inGameLines(view).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      {view.placed_by.length > 0 && (
        <div className="megastructure-add-lines">
          <span className="muted">Placed by</span>
          <ul>
            {view.placed_by.map((key) => (
              <li key={key}>
                <code>{key}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

/** An object's key, which tells apart two objects of one name. */
function KeyLine({ view }: { view: AmbientObjectView }) {
  return (
    <span className="megastructure-add-summary muted">
      <code>{view.key}</code>
    </span>
  );
}

/**
 * Adds an ambient object where the system view's menu was opened: an object picked from the list,
 * searched by name, shown in the preview.
 */
function AddAmbientObjectForm({ prompt }: { prompt: AmbientObjectAddPrompt }) {
  const cancel = useAmbientObjectAddStore((s) => s.cancel);
  const add = useAmbientObjectAddStore((s) => s.add);
  const last = useAmbientObjectAddStore((s) => s.last);
  const { views, problem } = useAmbientObjectViews();
  const { frame } = useSystemGeometry(prompt.system);
  const [systemName] = useSystemNames([prompt.system]);
  const entries = useMemo(() => (views === null ? [] : ambientObjectEntries(views)), [views]);
  const keyed = useMemo(() => sharedNameKeys(entries), [entries]);
  const at = aboutMainStar(prompt, mainStarPoint(frame.layout, frame.details));
  const [picked, setPicked] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const visible = useMemo(() => matchingAmbientObjects(entries, query), [entries, query]);
  const wanted = picked ?? last;
  const found = visible.find((v) => v.key === wanted) ?? visible[0] ?? null;
  const confirm = () => {
    if (found !== null) void add(found.key);
  };

  return (
    <PlaceDialog
      className="ambient-object-add-dialog"
      title={`Add an ambient object in ${systemName}`}
      where={whereText({ kind: "space", ...at }, undefined)}
      addLabel="Add"
      addable={found !== null}
      onCancel={cancel}
      onConfirm={confirm}
    >
      {problem !== null ? (
        <div className="field">
          <span>Type</span>
          <output className="muted">{problem}</output>
        </div>
      ) : views === null ? (
        <div className="megastructure-add-loading" role="status" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          {READING_AMBIENT_OBJECTS}
        </div>
      ) : entries.length === 0 ? (
        <div className="field">
          <span>Type</span>
          <output className="muted">{NO_AMBIENT_OBJECT_TYPES}</output>
        </div>
      ) : (
        <div className="megastructure-add-browse ambient-object-add-browse">
          <PortraitList
            entries={visible}
            current={found}
            keyOf={(view) => view.key}
            heading={ambientObjectGroup}
            portrait={(view) => view.portrait}
            name={(view) => view.name}
            details={(view) => (keyed.has(view.key) ? <KeyLine view={view} /> : null)}
            filterLabel="Filter ambient objects"
            listLabel="Ambient objects"
            noMatch={NO_AMBIENT_OBJECT_MATCHES}
            query={query}
            onQuery={setQuery}
            onSelect={(view) => setPicked(view.key)}
            onConfirm={confirm}
          />
          {found === null ? (
            <div className="muted">{NO_AMBIENT_OBJECT_MATCHES}</div>
          ) : (
            <AmbientObjectPreview view={found} keyed={keyed.has(found.key)} />
          )}
        </div>
      )}
    </PlaceDialog>
  );
}
