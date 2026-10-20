## Layout specs

Some screens have a measured layout table in [docs/design/specs/](../design/specs/). The table is columns of
`id, parent, role, text, x, y, w, h, padding t/r/b/l, layout, gap, tol px`, in CSS pixels, measured on the canvas
size written at the top of the file. Read the table top to bottom: a row's `parent` is the row it sits inside.

How to read a row:

- **x, y** are the top-left corner on the canvas (page coordinates, not relative to the parent).
- **w = fill** fills the parent's inner width. **-** in padding means the value was not measurable: free.
- **tol px** is how far each edge may be off. `derived` is an inferred group (id `gN`): it may have no element.
- **Text rows** are checked on left and top only (the table follows the line box, not the glyphs).
- **text** is the exact copy. Use it verbatim. A `[T3]` placeholder means the copy was redacted: take it from the spec.

What the table does not say: colors, fonts, radius, shadows, states, responsive behaviour. Those come from
`tokens.css`, the components in `src/components/ui/`, and the spec. A table covers one canvas size only. Other
breakpoints follow the spec and the shell rules above.

Interaction with the invariants:

- **Visual box versus hit area.** An icon row of 14 x 14 is the *visual* box. The 44 x 44 touch target is
  still required, so the button around it is larger (padding or a pseudo-element) and the icon carries the
  `data-ui-id`. The test measures the icon, not the button.
- **Tokens.** A table value within its `tol px` of a spacing token uses that token. Otherwise stop and ask. Do not hardcode.
- **Hints.** Words like `row, center` and groups named `gN` describe how the model saw the boxes. They help,
  they do not override the numbers.
- **Known gaps.** The header of each table lists what the measurement missed (for example a hairline or an
  element that was not detected). The spec, not the table, decides how to build those.
