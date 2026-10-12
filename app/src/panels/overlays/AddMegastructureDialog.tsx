import { useMemo, useState, type FormEvent } from "react";
import {
  HABITAT_OWNER_NOTE,
  NO_MEGASTRUCTURE_FITS,
  NO_OWNER,
  NO_OWNER_NOTE,
  OWNER_NOTE,
  WRITTEN_FINISHED,
  addLabel,
  entryDefault,
  matchingEntries,
  megastructureEntries,
  megastructureRefusal,
  selectedStage,
  whereText,
  writtenAsHabitat,
} from "../../lib/megastructurePicks";
import {
  megastructureDescriptionKeys,
  megastructurePreview,
  ownerCulture,
} from "../../lib/megastructurePreview";
import { templateName } from "../../lib/names";
import { useSystemNames } from "../../store/browserRows";
import { useDetailsStore } from "../../store/detailsStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore, useGameTexts } from "../../store/gameDataStore";
import {
  useMegastructureAddStore,
  type MegastructureAddPrompt,
} from "../../store/megastructureAdd";
import { Dialog } from "../Dialog";
import { useSystemBodyNames } from "../inspector/entity/useBodyName";
import { useNamed } from "../useNamed";
import {
  MegastructureList,
  MegastructurePreviewPane,
  MegastructureStages,
} from "./MegastructureBrowser";
import "./overlays.css";

const NO_KEYS: readonly string[] = [];

/** The Add megastructure dialog, while the system view's menu has asked for it. */
export function AddMegastructureDialog() {
  const prompt = useMegastructureAddStore((s) => s.prompt);
  return prompt === null ? null : <AddMegastructureForm prompt={prompt} />;
}

/**
 * Adds a megastructure where the system view's menu was opened: a megastructure picked from the
 * list, one of its stages from the tiles beside it, shown in the preview. It goes to the system's
 * owner, as the game gives it on load.
 */
function AddMegastructureForm({ prompt }: { prompt: MegastructureAddPrompt }) {
  const cancel = useMegastructureAddStore((s) => s.cancel);
  const add = useMegastructureAddStore((s) => s.add);
  const last = useMegastructureAddStore((s) => s.last);
  const { system, spot } = prompt;
  const types = useGameDataStore((s) => s.megastructureTypes);
  const names = useGameDataStore((s) => s.names);
  const countries = useGalaxyStore((s) => s.countries);
  const globalFlags = useGalaxyStore((s) => s.globalFlags);
  const owner = useGalaxyStore((s) => s.systems.get(system)?.owner ?? null);
  const details = useDetailsStore((s) => s.details);
  const icons = useDetailsStore((s) => s.resourceIcons);
  const [systemName] = useSystemNames([system]);
  const bodyName = useSystemBodyNames(system);
  const typeKeys = useMemo(() => [...types.keys()], [types]);
  useNamed(typeKeys);
  const rows = details.get(system)?.megastructures;
  const entries = useMemo(
    () =>
      megastructureEntries(
        types,
        names,
        spot,
        (type) => megastructureRefusal(type, spot, rows ?? [], types),
        { globalFlags },
      ),
    [types, names, spot, rows, globalFlags],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const visible = useMemo(() => matchingEntries(entries, query), [entries, query]);
  const found = selectedStage(entries, visible, picked, spot, last);
  const text = useGameTexts(
    found === null
      ? NO_KEYS
      : megastructureDescriptionKeys(found.stage.key, found.entry, found.stage.variant),
  );
  const type = found === null ? undefined : types.get(found.stage.variant);
  const culture = ownerCulture(owner, details.values(), countries);
  const ownerCountry = owner === null ? undefined : countries.get(owner);
  const where = whereText(spot, type, spot.kind === "body" ? bodyName(spot.body)?.text : undefined);
  const addable = found !== null && found.stage.refused === null;

  const confirm = () => {
    if (addable) void add(found.stage.variant, found.stage.key);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    confirm();
  };

  return (
    <Dialog
      className="open-dialog megastructure-add-dialog"
      label={`Add a megastructure in ${systemName}`}
      onClose={cancel}
      onDismiss={cancel}
    >
      <form onSubmit={submit}>
        <div className="open-dialog-head">
          <h1>Add a megastructure in {systemName}</h1>
        </div>
        <div className="open-dialog-body megastructure-add-body">
          <div className="field">
            <span>Where</span>
            <output>{where}</output>
          </div>
          <div className="field">
            <span>Owner</span>
            <output>
              {type?.habitat ? (
                <>
                  {NO_OWNER} <span className="muted">{HABITAT_OWNER_NOTE}</span>
                </>
              ) : (
                <>
                  {owner === null
                    ? NO_OWNER
                    : ownerCountry
                      ? templateName(ownerCountry)
                      : `Empire #${owner}`}{" "}
                  <span className="muted">{owner === null ? NO_OWNER_NOTE : OWNER_NOTE}</span>
                </>
              )}
            </output>
          </div>
          {entries.length === 0 ? (
            <div className="field">
              <span>Type</span>
              <output className="muted">{NO_MEGASTRUCTURE_FITS}</output>
            </div>
          ) : (
            <div className="megastructure-add-browse">
              <MegastructureList
                entries={visible}
                current={found?.entry ?? null}
                query={query}
                onQuery={setQuery}
                onSelect={(entry) => setPicked(entryDefault(entry))}
                onConfirm={confirm}
              />
              {found === null ? (
                <div className="muted">No megastructure matches.</div>
              ) : (
                <MegastructureStages
                  entry={found.entry}
                  types={types}
                  culture={culture}
                  current={found.stage.key}
                  onSelect={setPicked}
                  onConfirm={confirm}
                />
              )}
              {found !== null && (
                <MegastructurePreviewPane
                  preview={megastructurePreview(
                    found.stage,
                    found.chain,
                    found.entry,
                    type,
                    names,
                    icons,
                    text,
                  )}
                  type={type}
                  culture={culture}
                />
              )}
            </div>
          )}
          <div className="muted">
            {type?.habitat ? writtenAsHabitat(owner !== null) : WRITTEN_FINISHED}
          </div>
        </div>
        <div className="open-dialog-foot">
          <div className="setup-actions">
            <button type="button" onClick={cancel}>
              Cancel
            </button>
            <button type="submit" disabled={!addable}>
              {found === null ? "Add" : addLabel(found.stage, found.chain)}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
