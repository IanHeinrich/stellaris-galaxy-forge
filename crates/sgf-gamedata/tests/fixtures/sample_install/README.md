# Sample install

This install lets Prepare's tests run without Stellaris. It holds the initializers that four
scenarios use: the 4.4 and the 4.5 sample saves, each exported as a plain scenario and for
Paint a Galaxy. It also holds the layouts the tests set, the seat starts and random empire
starts Prepare writes, the plain layouts Plain system draws from, and every initializer that
places one of these. `common::sample_install()` loads it.

Files and initializers keep the install's names and order. The plain layouts are copied
whole. So are `breachsealer_system` and `hostile_init_21`, which the special-system tests
add with what their scripts plant, with the planet classes and the dig site type they
name. Every other initializer keeps its `class`, `usage`, `usage_odds`, `max_instances`,
`flags` and `primitive_system` as written. Its `create_country`, `spawn_system` and
`neighbor_system` blocks are cut to a name and type or an initializer key, and its pre-FTL
planets to a class and `generate_pre_ftls_on_planet`. An initializer written through an
inline script takes these values from the parsed install. Country types keep their
leviathan, enclave and fallen empire flags. Star classes keep `class`, `planet` and
`spawn_odds`. Planet classes keep `star` and `asteroid`. `rl_standard_stars` and the global
`@` variables the copied text uses are copied as written.

`prepare_rows::the_sample_install_classifies_the_samples_as_the_real_install_does` fails
when the game changes something Prepare reads. To cut the install again:

1. Run `cargo test -p sgf-gamedata --test integration sample_install_facts -- --ignored`. It
   writes the facts file and prints its path. `SGF_SAMPLE_INSTALL_FACTS` sets another path.
2. Assemble the folder from that file and the install. Each `init <file> <key> plain|trim`
   line names a block in `common/solar_system_initializers/<file>`, with the facts for it on
   the indented lines below. Copy a `plain` block whole. Write a `trim` block as described
   above, filling in from its facts any statement its text does not hold. Add the file's own
   `@` variables the blocks use.
3. Cut the `country_type`, `class` and `planet_class` lines' entries out of
   `common/country_types`, `common/star_classes` and `common/planet_classes` in the same
   way. Copy the global `@` variables that are still undefined from
   `common/scripted_variables` into `common/scripted_variables/00_fixture.txt`.
4. Keep the stub `localisation/english/fx_l_english.yml`, then run the Prepare tests. Read
   any snapshot that changes before accepting it.
