import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  NO_MEGASTRUCTURE_FITS,
  READING_FITS,
  addLabel,
  fitsUnread,
  footerLine,
  ownerLine,
  whereText,
} from "../../lib/megastructureCopy";
import {
  entryDefault,
  hostHasMegastructure,
  matchingEntries,
  megastructureEntries,
  selectedStage,
  type MegastructureStage,
} from "../../lib/megastructurePicks";
import {
  CLEARING_LOADING,
  clearRefusal,
  clearingUnread,
  clearingWarning,
} from "../../lib/ringWorldAdd";
import { PLANET_KEPT_NOTE, planetChangeAt, planetChangeNote } from "../../lib/planetChangeAdd";
import {
  megastructureDescriptionKeys,
  megastructurePreview,
  ownerCulture,
  type MegastructurePreview,
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
import { useOpCheckStore } from "../../store/opCheckStore";
import { Dialog, DialogFrame } from "../Dialog";
import { useSystemBodyNames } from "../useBodyName";
import { useNamed } from "../useNamed";
import {
  MegastructureList,
  MegastructurePreviewPane,
  MegastructureStages,
} from "./MegastructureBrowser";
import { PlanetChangePicks } from "./PlanetChangePicks";
import { RingWorldPicks } from "./RingWorldPicks";
import "./overlays.css";

const NO_KEYS: readonly string[] = [];

/**
 * The preview of a whole ring world named as its Ring tile names its size, with no stage line and
 * no refusal, as the picks under the tiles show both.
 */
function ringPreview(
  preview: MegastructurePreview,
  stage: MegastructureStage,
): MegastructurePreview {
  return stage.ring === true
    ? { ...preview, label: stage.label, stage: null, refused: null }
    : preview;
}

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
  const addRing = useMegastructureAddStore((s) => s.addRing);
  const last = useMegastructureAddStore((s) => s.last);
  const ringClear = useMegastructureAddStore((s) => s.ringClear);
  const ringSize = useMegastructureAddStore((s) => s.ringSize);
  const clearing = useMegastructureAddStore((s) => s.clearing);
  const clearingError = useMegastructureAddStore((s) => s.clearingError);
  const loadClearing = useMegastructureAddStore((s) => s.loadClearing);
  const keepPlanet = useMegastructureAddStore((s) => s.keepPlanet);
  const fits = useMegastructureAddStore((s) => s.fits);
  const fitsError = useMegastructureAddStore((s) => s.fitsError);
  const loadFits = useMegastructureAddStore((s) => s.loadFits);
  const { system, spot } = prompt;
  const generation = useOpCheckStore((s) => s.generations.get(system) ?? 0);
  const dataVersion = useGameDataStore((s) => s.version);
  const types = useGameDataStore((s) => s.megastructureTypes);
  const names = useGameDataStore((s) => s.names);
  const countries = useGalaxyStore((s) => s.countries);
  const owner = useGalaxyStore((s) => s.systems.get(system)?.owner ?? null);
  const details = useDetailsStore((s) => s.details);
  const icons = useDetailsStore((s) => s.resourceIcons);
  const [systemName] = useSystemNames([system]);
  const bodyName = useSystemBodyNames(system);
  const typeKeys = useMemo(() => [...types.keys()], [types]);
  useNamed(typeKeys);
  const rows = details.get(system)?.megastructures;
  const entries = useMemo(
    () => (fits === null ? [] : megastructureEntries(types, names, fits, ringSize)),
    [types, names, fits, ringSize],
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
  const orbitHosted = type?.habitat_orbital === true && !hostHasMegastructure(spot, rows ?? []);
  const ring = found?.stage.ring === true;
  const planetChange = found?.stage.refused === null ? planetChangeAt(type, spot) : null;
  const spotClass = spot.kind === "body" ? (spot.class ?? null) : null;
  const planetText = spot.kind === "body" ? bodyName(spot.body)?.text : undefined;
  const planetNote =
    planetChange === null
      ? ""
      : ` ${keepPlanet ? PLANET_KEPT_NOTE : planetChangeNote(planetText ?? "The planet", planetChange, names)}`;
  const size = found?.chain.kind === "ring" ? found.entry.size : null;
  const nameOf = (body: number) => bodyName(body)?.text ?? `#${body}`;
  const clearBlocked =
    clearingError !== null
      ? clearingUnread(clearingError)
      : clearing === null
        ? CLEARING_LOADING
        : clearRefusal(clearing, nameOf);
  const clears = ring && ringClear && clearBlocked === null;
  const addable = found !== null && found.stage.refused === null && !(ring && ringClear && !clears);
  const owning = ownerLine(
    type?.habitat === true,
    owner,
    ownerCountry === undefined ? null : templateName(ownerCountry),
    orbitHosted,
  );
  const kind = { ring, habitat: type?.habitat === true, orbital: type?.habitat_orbital === true };

  useEffect(() => {
    void loadFits(generation);
  }, [generation, dataVersion, loadFits]);

  useEffect(() => {
    if (ring) void loadClearing();
  }, [ring, loadClearing]);

  const confirm = () => {
    if (!addable) return;
    if (found.stage.ring) void addRing(found.stage.variant, found.stage.key);
    else void add(found.stage.variant, found.stage.key);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    confirm();
  };

  return (
    <Dialog
      className="dialog megastructure-add-dialog"
      label={`Add a megastructure in ${systemName}`}
      onClose={cancel}
      onDismiss={cancel}
    >
      <DialogFrame
        title={<>Add a megastructure in {systemName}</>}
        bodyClassName="megastructure-add-body"
        onSubmit={submit}
        actions={
          <>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!addable}>
              {found === null ? "Add" : addLabel(found.stage, found.chain)}
            </button>
          </>
        }
      >
        <div className="field">
          <span>Where</span>
          <output>{where}</output>
        </div>
        <div className="field">
          <span>Owner</span>
          <output>
            {owning.name} <span className="muted">{owning.note}</span>
          </output>
        </div>
        {entries.length === 0 ? (
          <div className="field">
            <span>Type</span>
            <output className="muted">
              {fitsError !== null
                ? fitsUnread(fitsError)
                : fits === null
                  ? READING_FITS
                  : NO_MEGASTRUCTURE_FITS}
            </output>
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
              <div className="megastructure-add-middle">
                <MegastructureStages
                  entry={found.entry}
                  types={types}
                  culture={culture}
                  current={found.stage.key}
                  onSelect={setPicked}
                  onConfirm={confirm}
                />
                {size !== null && (ring || found.entry.sizes.length > 1) && (
                  <RingWorldPicks
                    sizes={found.entry.sizes}
                    size={size}
                    ring={ring}
                    clearBlocked={clearBlocked}
                  />
                )}
                {planetChange !== null && (
                  <PlanetChangePicks change={planetChange} planetClass={spotClass} names={names} />
                )}
              </div>
            )}
            {found !== null && (
              <MegastructurePreviewPane
                preview={ringPreview(
                  megastructurePreview(
                    found.stage,
                    found.chain,
                    found.entry,
                    type,
                    names,
                    icons,
                    text,
                  ),
                  found.stage,
                )}
                type={type}
                culture={culture}
              />
            )}
          </div>
        )}
        {clears && clearing !== null ? (
          <div className="megastructure-add-refusal">{clearingWarning(clearing, nameOf)}</div>
        ) : (
          <div className="muted">{footerLine(kind, owner !== null, orbitHosted, planetNote)}</div>
        )}
      </DialogFrame>
    </Dialog>
  );
}
