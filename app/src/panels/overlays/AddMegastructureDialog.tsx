import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  HABITAT_ORBITAL_OWNER_NOTE,
  HABITAT_OWNER_NOTE,
  NO_MEGASTRUCTURE_FITS,
  NO_OWNER,
  NO_OWNER_NOTE,
  OWNER_NOTE,
  WRITTEN_FINISHED,
  addLabel,
  entryDefault,
  habitatOrbitalNote,
  hostHasMegastructure,
  matchingEntries,
  megastructureEntries,
  megastructureRefusal,
  selectedStage,
  whereText,
  writtenAsHabitat,
} from "../../lib/megastructurePicks";
import {
  CLEARING_LOADING,
  RING_WRITTEN,
  clearRefusal,
  clearingUnread,
  clearingWarning,
  ringSummary,
} from "../../lib/ringWorldAdd";
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
import { Dialog } from "../Dialog";
import { useSystemBodyNames } from "../inspector/entity/useBodyName";
import { useNamed } from "../useNamed";
import {
  MegastructureList,
  MegastructurePreviewPane,
  MegastructureStages,
} from "./MegastructureBrowser";
import { RingWorldPicks } from "./RingWorldPicks";
import "./overlays.css";

const NO_KEYS: readonly string[] = [];

/** The preview with its stage line given over to the ring world's picks, when there are any. */
function ringPreview(preview: MegastructurePreview, summary: string | null): MegastructurePreview {
  return summary === null ? preview : { ...preview, stage: summary };
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
  const ringStages = useMegastructureAddStore((s) => s.ringStages);
  const ringClear = useMegastructureAddStore((s) => s.ringClear);
  const clearing = useMegastructureAddStore((s) => s.clearing);
  const clearingError = useMegastructureAddStore((s) => s.clearingError);
  const loadClearing = useMegastructureAddStore((s) => s.loadClearing);
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
  const planets = details.get(system)?.planets;
  const entries = useMemo(
    () =>
      megastructureEntries(
        types,
        names,
        spot,
        (type) => megastructureRefusal(type, spot, rows ?? [], types, planets ?? []),
        { globalFlags },
      ),
    [types, names, spot, rows, planets, globalFlags],
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
  const nameOf = (body: number) => bodyName(body)?.text ?? `#${body}`;
  const clearBlocked =
    clearingError !== null
      ? clearingUnread(clearingError)
      : clearing === null
        ? CLEARING_LOADING
        : clearRefusal(clearing, nameOf);
  const clears = ring && ringClear && clearBlocked === null;
  const addable = found !== null && found.stage.refused === null && !(ring && ringClear && !clears);

  useEffect(() => {
    if (ring) void loadClearing();
  }, [ring, loadClearing]);

  const confirm = () => {
    if (!addable) return;
    if (found.stage.ring) void addRing(found.stage.key);
    else void add(found.stage.variant, found.stage.key);
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
                  {NO_OWNER}{" "}
                  <span className="muted">
                    {HABITAT_OWNER_NOTE}
                    {orbitHosted && owner !== null ? ` ${HABITAT_ORBITAL_OWNER_NOTE}` : ""}
                  </span>
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
                <div className="megastructure-add-middle">
                  <MegastructureStages
                    entry={found.entry}
                    types={types}
                    culture={culture}
                    current={found.stage.key}
                    onSelect={setPicked}
                    onConfirm={confirm}
                  />
                  {ring && found.stage.refused === null && (
                    <RingWorldPicks clearBlocked={clearBlocked} />
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
                    ring ? ringSummary(ringStages) : null,
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
            <div className="muted">
              {ring
                ? RING_WRITTEN
                : type?.habitat
                  ? writtenAsHabitat(owner !== null)
                  : WRITTEN_FINISHED}
              {type?.habitat && type.habitat_orbital
                ? ` ${habitatOrbitalNote(owner !== null, !orbitHosted)}`
                : ""}
            </div>
          )}
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
