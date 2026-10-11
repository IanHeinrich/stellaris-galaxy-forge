import { useMemo, useState, type FormEvent } from "react";
import {
  NO_MEGASTRUCTURE_FITS,
  WRITTEN_FINISHED,
  defaultOwner,
  familyPick,
  megastructureFamilies,
  megastructurePicks,
  whereText,
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
import { useGameDataStore } from "../../store/gameDataStore";
import {
  useMegastructureAddStore,
  type MegastructureAddPrompt,
} from "../../store/megastructureAdd";
import { Dialog } from "../Dialog";
import { useSystemBodyNames } from "../inspector/entity/useBodyName";
import { useNamed } from "../useNamed";
import { MegastructurePreviewPane, MegastructureTiles } from "./MegastructureBrowser";
import "./overlays.css";

const NO_OWNER = "none";

/** The mod a type comes from: the type view does not say, so every family is listed as the game's. */
const fromGame = () => null;

/** The Add megastructure dialog, while the system view's menu has asked for it. */
export function AddMegastructureDialog() {
  const prompt = useMegastructureAddStore((s) => s.prompt);
  return prompt === null ? null : <AddMegastructureForm prompt={prompt} />;
}

/**
 * Adds a megastructure where the system view's menu was opened: its type, chosen by upgrade
 * family from tiles of its stages beside a preview of the selected one, and its owner, the
 * system's for a working structure and no one for a ruin.
 */
function AddMegastructureForm({ prompt }: { prompt: MegastructureAddPrompt }) {
  const cancel = useMegastructureAddStore((s) => s.cancel);
  const add = useMegastructureAddStore((s) => s.add);
  const { system, spot } = prompt;
  const types = useGameDataStore((s) => s.megastructureTypes);
  const names = useGameDataStore((s) => s.names);
  const countries = useGalaxyStore((s) => s.countries);
  const systemOwner = useGalaxyStore((s) => s.systems.get(system)?.owner ?? null);
  const details = useDetailsStore((s) => s.details);
  const icons = useDetailsStore((s) => s.resourceIcons);
  const [systemName] = useSystemNames([system]);
  const bodyName = useSystemBodyNames(system);
  const typeKeys = useMemo(() => [...types.keys()], [types]);
  useNamed(typeKeys);
  const families = useMemo(
    () => megastructureFamilies(megastructurePicks(types, names, spot), fromGame),
    [types, names, spot],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [ownerPicked, setOwnerPicked] = useState<number | null | undefined>(undefined);
  const family = families.find((f) => f.picks.some((p) => p.key === picked)) ?? families[0] ?? null;
  const current =
    family === null ? null : (family.picks.find((p) => p.key === picked) ?? familyPick(family));
  useNamed(current === null ? [] : megastructureDescriptionKeys(current));
  const kind = current?.key;
  const type = kind === undefined ? undefined : types.get(kind);
  const owner = ownerPicked === undefined ? defaultOwner(kind ?? "", systemOwner) : ownerPicked;
  const culture = ownerCulture(owner, details.values());
  const owners = useMemo(
    () =>
      [...countries.values()]
        .map((country) => ({ id: country.id, name: templateName(country) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [countries],
  );
  const where = whereText(spot, type, spot.kind === "body" ? bodyName(spot.body)?.text : undefined);

  const confirm = () => {
    if (kind !== undefined) void add(kind, owner);
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
          <label className="field">
            <span>Owner</span>
            <select
              value={owner === null ? NO_OWNER : String(owner)}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setOwnerPicked(value === NO_OWNER ? null : Number(value));
              }}
            >
              <option value={NO_OWNER}>No owner</option>
              {owners.map((country) => (
                <option key={country.id} value={country.id}>
                  {country.name}
                </option>
              ))}
            </select>
          </label>
          {current === null || family === null ? (
            <div className="field">
              <span>Type</span>
              <output className="muted">{NO_MEGASTRUCTURE_FITS}</output>
            </div>
          ) : (
            <div className="megastructure-add-browse">
              <MegastructureTiles
                families={families}
                types={types}
                culture={culture}
                current={current}
                query={query}
                onQuery={setQuery}
                onSelect={setPicked}
                onConfirm={confirm}
              />
              <MegastructurePreviewPane
                preview={megastructurePreview(current, family, type, names, icons)}
                type={type}
                culture={culture}
              />
            </div>
          )}
          <div className="muted">{WRITTEN_FINISHED}</div>
        </div>
        <div className="open-dialog-foot">
          <div className="setup-actions">
            <button type="button" onClick={cancel}>
              Cancel
            </button>
            <button type="submit" disabled={kind === undefined}>
              Add
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
