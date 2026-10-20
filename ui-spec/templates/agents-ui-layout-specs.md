## UI layout specs

A screen with a layout table has `docs/design/specs/<screen>.spec.md` (human) and `<screen>.spec.json` (tests).
The table is measured locally from the design. It is the layout source of truth for that screen.

- The table is the only design input. Never ask for, attach or look for screenshots or Figma access.
- Geometry (x, y, w, h, padding, gap) is binding within the row's `tol px`. The `layout` words and inferred
  groups (ids like `g4`, tol `derived`) are hints: if they disagree with the numbers, follow the numbers.
- Put `data-ui-id="<id>"` on the element whose box matches the row. For text rows, on the element that hugs the text.
  Inferred groups are optional.
- `w = fill` means fill the parent's inner width. `-` in padding means not measured: free.
- Colors, type, radius and elevation come from tokens, never from the table (it has none).
- A table value within its `tol px` of a spacing token uses the token. If no token is within tol, stop and ask.
- Generated tests live in `tests/ui-spec/`. Never edit or loosen them. A wrong table is fixed by an amendment spec.
- Read [docs/context/ui-spec-local-boundary.md](docs/context/ui-spec-local-boundary.md) before touching anything under `docs/design/`.
