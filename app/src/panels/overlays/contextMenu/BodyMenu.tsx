import { ADD_MOON_LABEL, takesMoons } from "../../../lib/addBody";
import { lockedToName } from "../../../lib/details/orbitIntent";
import { nextMoonRing, orbitParent } from "../../../lib/details/orbitReach";
import { planetPageOffers } from "../../../lib/details/planetOffers";
import { deleteLabel, deleteOp } from "../../../lib/details/planetRemoval";
import { isRingSegment } from "../../../lib/details/ringWorldRemoval";
import { documentCapabilities } from "../../../lib/capabilities";
import { ADD_MEGASTRUCTURE_LABEL, BODY_HAS_MEGASTRUCTURE } from "../../../lib/megastructurePicks";
import { isStarBody } from "../../../lib/details/starBody";
import { backToGalaxy } from "../../../store/commands";
import { useDetailsStore } from "../../../store/detailsStore";
import { useEditorStore } from "../../../store/editorStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { planetEditAdapterFor } from "../../../store/planetEditAdapter";
import { bodyEntry, useInspectorStore } from "../../../store/inspectorStore";
import type { ContextTarget } from "../../../store/mapChromeStore";
import { useSceneStore } from "../../../store/sceneStore";
import { useSystemGeometry } from "../../../store/systemGeometry";
import { useSystemBodyNames } from "../../inspector/entity/useBodyName";
import { useOpCheck } from "../../useOpCheck";
import { AddBodyItems } from "./AddBodyItems";
import { AddMegastructureItem } from "./AddMegastructureItem";
import { MenuFrame, type Frame } from "./MenuFrame";
import { MenuItem } from "./MenuItem";
import { RingWorldItem } from "./RingWorldItem";
import { CopyItem, CutItem } from "./PlanetMoveItems";

/**
 * The menu on a body in the system view: its page, the selection's cut and copy, its lock, a
 * new moon or megastructure on it, its deletion or its ring world's, and the way back out.
 */
export function BodyMenu({
  target,
  frame,
}: {
  target: Extract<ContextTarget, { kind: "body" }>;
  frame: Frame;
}) {
  const openFromMap = useInspectorStore((s) => s.openFromMap);
  const details = useDetailsStore((s) => s.details.get(target.system));
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const addBodyAt = useEditorStore((s) => s.addBodyAt);
  const { layout, editing, frame: geometry } = useSystemGeometry(target.system);
  const locked = useSceneStore((s) => s.lockedBodies.has(target.id));
  const lockBody = useSceneStore((s) => s.lockBody);
  const unlockBody = useSceneStore((s) => s.unlockBody);
  const named = useSystemBodyNames(target.system);
  const nameOf = (id: number) => named(id)?.text;
  const listed = named(target.id);
  const name = listed?.text;
  const placed = layout.bodies.find((b) => b.id === target.id);
  const lockable = placed !== undefined && editing.bodies.get(target.id)?.move === true;
  const planet = details?.planets.find((p) => p.id === target.id);
  const moon = planet?.moon === true;
  const capabilities = useFileSessionStore((s) => documentCapabilities(s));
  const star = planet !== undefined && isStarBody(planet.class, planetClasses, starClasses);
  const offers = planetPageOffers(capabilities, {
    star,
    ringable: false,
    moonHost:
      planet !== undefined &&
      takesMoons(
        planet,
        details?.planets.find((p) => p.id === planet.parent),
        {
          star,
          asteroid: planetClasses.get(planet.class)?.asteroid === true,
        },
      ),
  });
  const addMoon = (planetClass: string | null) =>
    addBodyAt(
      target.system,
      { radius: nextMoonRing(geometry, target.id), angle: 0 },
      target.id,
      planetClass,
    );
  return (
    <MenuFrame {...frame} label={name}>
      {name !== undefined && <div className="context-menu-header">{name}</div>}
      <MenuItem
        disabled={name === undefined}
        run={() => {
          if (listed !== undefined) openFromMap(bodyEntry(target.system, target.id, listed.text));
        }}
      >
        Inspect
      </MenuItem>
      <CutItem system={target.system} />
      {!star && <CopyItem system={target.system} />}
      {lockable &&
        (locked ? (
          <MenuItem run={() => unlockBody(target.id)}>Unlock</MenuItem>
        ) : (
          <MenuItem run={() => lockBody(target.id)}>
            {`Lock to ${lockedToName(orbitParent(layout, placed), nameOf)}`}
          </MenuItem>
        ))}
      {offers.addMoon && <AddBodyItems label={ADD_MOON_LABEL} moon add={addMoon} />}
      {offers.addMegastructure && planet !== undefined && (
        <AddMegastructureItem
          system={target.system}
          spot={{ kind: "body", body: target.id, star, class: planet.class }}
          label={ADD_MEGASTRUCTURE_LABEL}
          refusal={
            details?.megastructures.some((m) => m.planet === target.id)
              ? BODY_HAS_MEGASTRUCTURE
              : null
          }
        />
      )}
      {offers.deleteBody &&
        name !== undefined &&
        (planet !== undefined && isRingSegment(planet.class) ? (
          <RingWorldItem system={target.system} />
        ) : (
          <DeleteItem system={target.system} planet={target.id} name={name} moon={moon} />
        ))}
      <MenuItem className="context-menu-separated" run={backToGalaxy}>
        Back to galaxy
      </MenuItem>
    </MenuFrame>
  );
}

/** Deletes the body with its moons, or says why it cannot: offered once the core has answered. */
function DeleteItem({
  system,
  planet,
  name,
  moon,
}: {
  system: number;
  planet: number;
  name: string;
  moon: boolean;
}) {
  const refusal = useOpCheck(deleteOp(planet), system);
  const kind = useFileSessionStore((s) => s.kind);
  return (
    <MenuItem
      disabled={refusal !== null}
      className={refusal ? "hinted" : undefined}
      title={refusal ?? undefined}
      run={() => planetEditAdapterFor(kind, { system, id: planet }).remove(name, moon)}
    >
      {deleteLabel(moon)}
      {refusal && <span className="muted">{refusal}</span>}
    </MenuItem>
  );
}
