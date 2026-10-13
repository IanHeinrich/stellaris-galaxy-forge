# ADR 0007: Draw structures from sprites baked from the game's models

Accepted

## Context

The system view shows a system's megastructures and starbase, and the models of some planets such as a ring world's
segments and a habitat. The game draws each of them from a 3D model: a binary `.mesh` file, the `.asset` and `.gfx`
text files that place its parts and name its textures, and DDS maps. The vanilla game has hundreds of such models and
Gigastructural Engineering adds hundreds more. The map is a 2D PixiJS scene, and nothing from the game or its mods
may be bundled with the editor, so a picture of a structure has to be made from the player's own install.

## Decision

`sgf-gamedata` bakes a model into a 2D sprite when the app asks for it. The texture key is
`model:<culture>:<entity>[:yaw<degrees>][:tilt<degrees>][:px<pixels>]`, and the answer is a PNG with the sprite's size in save units and the point
where the model's origin falls, kept in a text chunk of the PNG (`ModelPlacement`).

- `textures/model/assets.rs` reads the `.asset` and `.gfx` files under `gfx/models` once per layout, as
  `Assets`, and resolves an entity into the meshes it draws with the chain of attachments that places each. The entity
  is looked up as `<culture>_<entity>` for the culture and each of its fallbacks, then as `mammalian_01_<entity>`, then
  as the bare `<entity>`. For a structure no empire owns, the bare `<entity>` comes first.
- `mesh.rs` reads the `.mesh` format, and `raster.rs` draws the meshes on the CPU from one fixed, slightly tilted
  camera: a depth buffer, the diffuse map, the normal map, the empire colour mask from the specular map's red, and one
  light, supersampled and cropped to the model. The sprite's size in pixels follows what the model covers at the
  system view's closest zoom, within a least and a most.
- How a mesh blends and which of its faces are drawn follows its shader's name, from the tables in
  `mod_compatibility/`. A shader in no table is drawn opaque, on one face, tinted by the owner. `sgf gamedata
  --report` lists the shaders megastructure models use that no table names.
- Skinned animation (the bind pose is drawn), particles, specular and environment light, bloom, atmospheres, and
  additive or scrolling extras are not drawn.
- The app turns a model by asking for the key with a yaw in whole degrees, so a structure faces the star. It draws the
  sprite at its placement in the `StructuresLayer`, and draws the structure's map icon where the model is unknown or
  fails to bake. `store/modelPrewarm.ts` asks for a document's models in the background once the save and the game
  data are both in, so the system view finds them baked.
- A baked sprite is cached as a PNG in the platform cache directory. Its name is a hash of the key, the layer roots,
  the mesh files and textures the model draws with their lengths and modification times, and a `BAKE` version that
  is raised when the baker changes. A file nobody has asked for in thirty days is deleted at start-up. The cache
  holds content from the player's install and is never committed or bundled.

Planet and star discs (`planet_disc:<class>`, `star_disc:<class>`) are baked the same way, from a class's surface map
or from the star shader's maps and colours.

## Alternatives considered

- Map icons only. They are what a structure with no model shows now. They don't tell a Dyson Sphere from a Matrioshka
  Brain or show a ring world's damaged sections, and the game's own picture is the clearest answer to "what is this".
- Real 3D in the webview. It needs the meshes and textures sent to the webview, a 3D camera and shaders beside the 2D
  scene, and a second render path to keep in step with the map's picking and layering. The model is drawn from one
  angle, so a baked sprite loses nothing the map shows.
- Shipping pre-rendered sprites in the app. It breaks the rule that nothing from the game or its mods is bundled, and
  it could not cover a mod the player installs.

## Consequences

- The editor carries a mesh reader and a software rasteriser. They draw the bind pose and one light, so a sprite is
  close to the game's picture and not the same.
- A model is baked once per install and set of mods. Changing a mod file or a texture gives the model a new cache
  name, and a change to the baker bumps `BAKE`, which bakes every model once more.
- A change under `gfx/models`, `gfx/worldgfx` or an interface `.gfx` file rebuilds the `Graphics` registries, and the
  app drops its textures when the rebuild names them.
- Shader families are data in `mod_compatibility/`. A mod whose shaders draw differently needs a table entry, or
  its models are drawn opaque until it has one.
- The script parser closes the blocks still open at the end of a `.gfx` or `.asset` file, as the game does for vanilla's
  `gfx/models/effects/nomads.gfx`. Any other script file that ends inside a block is a parse error (`install/script.rs`).
- The cache name hashes every texture the model's materials name, so each cached sprite bakes once more after that
  change. The old PNGs stay until the 30-day prune deletes them.
- A model that fails to bake shows its icon, with the reason in the texture's error.
