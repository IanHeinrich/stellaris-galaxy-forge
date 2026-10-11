import { useMemo, useState, type FormEvent } from "react";
import { MEGASTRUCTURE_ICON_KEY } from "../../lib/details/icons";
import {
  NO_MEGASTRUCTURE_FITS,
  WRITTEN_FINISHED,
  defaultOwner,
  megastructurePicks,
  whereText,
  type MegastructurePick,
} from "../../lib/megastructurePicks";
import { templateName } from "../../lib/names";
import { useSystemNames } from "../../store/browserRows";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import {
  useMegastructureAddStore,
  type MegastructureAddPrompt,
} from "../../store/megastructureAdd";
import { Dialog } from "../Dialog";
import { IconPicker, type IconPickerItem } from "../IconPicker";
import { useSystemBodyNames } from "../inspector/entity/useBodyName";
import { Icon } from "../parts";
import "./overlays.css";

const NO_OWNER = "none";

function pickItem(pick: MegastructurePick): IconPickerItem {
  return {
    key: pick.key,
    label: pick.label,
    icon: <Icon className="pi mega" keys={[MEGASTRUCTURE_ICON_KEY]} glyph="◈" />,
    group: pick.family,
    note: pick.state ?? undefined,
  };
}

/** The Add megastructure dialog, while the system view's menu has asked for it. */
export function AddMegastructureDialog() {
  const prompt = useMegastructureAddStore((s) => s.prompt);
  return prompt === null ? null : <AddMegastructureForm prompt={prompt} />;
}

/**
 * Adds a megastructure where the system view's menu was opened: its type, grouped by upgrade
 * family, and its owner, the system's for a working structure and no one for a ruin.
 */
function AddMegastructureForm({ prompt }: { prompt: MegastructureAddPrompt }) {
  const cancel = useMegastructureAddStore((s) => s.cancel);
  const add = useMegastructureAddStore((s) => s.add);
  const { system, spot } = prompt;
  const types = useGameDataStore((s) => s.megastructureTypes);
  const names = useGameDataStore((s) => s.names);
  const countries = useGalaxyStore((s) => s.countries);
  const systemOwner = useGalaxyStore((s) => s.systems.get(system)?.owner ?? null);
  const [systemName] = useSystemNames([system]);
  const bodyName = useSystemBodyNames(system);
  const items = useMemo(
    () => megastructurePicks(types, names, spot).map(pickItem),
    [types, names, spot],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [ownerPicked, setOwnerPicked] = useState<number | null | undefined>(undefined);
  const current = items.find((item) => item.key === picked) ?? items[0];
  const kind = current?.key;
  const owner = ownerPicked === undefined ? defaultOwner(kind ?? "", systemOwner) : ownerPicked;
  const owners = useMemo(
    () =>
      [...countries.values()]
        .map((country) => ({ id: country.id, name: templateName(country) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [countries],
  );
  const where = whereText(
    spot,
    kind === undefined ? undefined : types.get(kind),
    spot.kind === "body" ? bodyName(spot.body)?.text : undefined,
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (kind !== undefined) void add(kind, owner);
  };

  return (
    <Dialog
      className="open-dialog"
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
            <span>Type</span>
            {current === undefined ? (
              <output className="muted">{NO_MEGASTRUCTURE_FITS}</output>
            ) : (
              <div className="megastructure-add-type">
                <IconPicker
                  label="Megastructure type"
                  current={current}
                  items={items}
                  triggerClassName="edit-field"
                  onPick={setPicked}
                />
              </div>
            )}
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
