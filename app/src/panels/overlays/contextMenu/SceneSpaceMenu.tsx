import { ADD_PLANET_LABEL } from "../../../lib/addBody";
import { documentCapabilities } from "../../../lib/capabilities";
import { defaultBeltKind } from "../../../lib/details/orbitIntent";
import { planetPageOffers } from "../../../lib/details/planetOffers";
import { ADD_MEGASTRUCTURE_HERE_LABEL } from "../../../lib/megastructurePicks";
import { placementAt } from "../../../lib/planetMove";
import { useSystemNames } from "../../../store/browserRows";
import type { ContextTarget } from "../../../store/mapChromeStore";
import { backToGalaxy } from "../../../store/commands";
import { useEditorStore } from "../../../store/editorStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { applyGeometry, useSystemGeometry } from "../../../store/systemGeometry";
import { AddBodyItems } from "./AddBodyItems";
import { AddMegastructureItem } from "./AddMegastructureItem";
import { MenuFrame, type Frame } from "./MenuFrame";
import { MenuItem } from "./MenuItem";
import { PasteItem } from "./PlanetMoveItems";

/**
 * The menu on the empty space of the system view: the cut or copied planets pasted where it was
 * pressed, a new planet, belt or megastructure there, and the way out.
 */
export function SceneSpaceMenu({
  target,
  frame,
}: {
  target: Extract<ContextTarget, { kind: "systemSpace" }>;
  frame: Frame;
}) {
  const [name] = useSystemNames([target.system]);
  const { editing, frame: geometry } = useSystemGeometry(target.system);
  const radius = Math.round(Math.hypot(target.x, target.y));
  const belt = editing.belts && radius > 0;
  const addBodyAt = useEditorStore((s) => s.addBodyAt);
  const capabilities = useFileSessionStore((s) => documentCapabilities(s));
  const offers = planetPageOffers(capabilities);
  const planet = offers.addPlanet && radius > 0;
  const addBelt = () =>
    applyGeometry({
      kind: "addBelt",
      system: target.system,
      beltKind: defaultBeltKind(geometry.details),
      radius,
    });
  return (
    <MenuFrame {...frame} label={name}>
      <div className="context-menu-header">{name}</div>
      <PasteItem system={target.system} at={placementAt(target.x, target.y)} />
      {planet && (
        <AddBodyItems
          label={ADD_PLANET_LABEL}
          moon={false}
          add={(planetClass) =>
            addBodyAt(target.system, placementAt(target.x, target.y), null, planetClass)
          }
        />
      )}
      {belt && <MenuItem run={addBelt}>Add belt here (r {radius})</MenuItem>}
      {offers.addMegastructure && (
        <AddMegastructureItem
          system={target.system}
          spot={{ kind: "space", x: target.x, y: target.y }}
          label={ADD_MEGASTRUCTURE_HERE_LABEL}
        />
      )}
      <MenuItem
        run={backToGalaxy}
        className={belt || planet || offers.addMegastructure ? "context-menu-separated" : undefined}
      >
        Back to galaxy
      </MenuItem>
    </MenuFrame>
  );
}
