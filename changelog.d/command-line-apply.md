### Changed

- `sgf apply <save> <edit.json>...` applies the edits in JSON files, in
  order. It replaces the commands that each made one edit, such as
  `sgf move` and `sgf lane`.
- `sgf add-system` and `sgf add-body` roll from the game's rules without
  `--generate` or `--roll`.
- `sgf details` with no id lists every system. `--all` is gone.
