# ADR-FREE-RESIZE: Keep-aspect choice at insert, handle-based free resize from the lasso

- Status: accepted (approved by owner 2026-09-24; revised the same day after on-device testing — D4/D5 superseded,
  see "Revision history"; implemented on `feat/issue-17-free-aspect-resize`)
- Date: 2026-09-24
- Deciders: SnShapes (owner: J-Raghavan)
- Spec: `spec/SPEC-FREE-RESIZE.md` (local, uncommitted per repo convention: spec/ is gitignored)
- Issue: #17 — "Feature request: resize a placed shape without keeping aspect ratio" (Reddit request)
- Amends: ADR-PEN-PLACEMENT D3 (native-lasso wording)

## Context and Problem Statement

A Reddit user wants to resize an inserted shape without keeping its aspect ratio. After insert, resizing goes
through the firmware's lasso handle, which scales width and height together (and scales the stroke width, see
ADR-PEN-PLACEMENT). `sn-plugin-lib` 0.1.65 has no API to change how that handle behaves.

Two things are in the plugin's control:

1. **Insert time.** Since v1.0.11 a drag on the overlay fits the shape into the swept box per axis
   (`placeGeometry`). That already produces stretched shapes, but it is undiscoverable, and there is no way to ask
   for the opposite (keep the shape's proportions while drawing the box).
2. **After insert.** With the shape lassoed, the plugin can read it (`getLassoGeometries`, `getLassoRect`,
   `getLassoElementTypeCounts`) and write arbitrary coordinates back (`modifyLassoGeometry`). A lasso-toolbar button
   (`registerButton` type 2) opens the plugin UI with the selection still active.

ADR-PEN-PLACEMENT D3 claimed per-axis scaling "is what the native lasso does". This report says otherwise.

## Decision Drivers

- Solve the request without depending on firmware behaviour we cannot change.
- Stroke width must stay as picked (the #5 / #15 complaint).
- "Free resize" must feel like resizing: grab the shape's box and pull, not draw a replacement (owner, on device).
- Reuse `placement.ts`, `lassoTransform.ts`, the `PlacementOverlay` responder pattern and the retained
  `ShapeOptionsPanel`; no parallel transform code.
- Pure logic host-tested; firmware-dependent steps isolated and listed for on-device confirmation.
- Phase 2 must be removable without touching Phase 1.

## Considered Options

- **A. Popup checkbox only.** Small and fully host-testable, but a placed shape still cannot be reshaped.
- **B. Lasso button only.** Reshapes placed shapes, but leaves the insert-time drag undiscoverable.
- **C. Both, in separable commits (chosen).**
- **D. `resizeLassoRect` with a non-uniform rect.** Cheapest for Phase 2, but the firmware would scale the stroke and
  it is unknown whether it honours a non-uniform rect. Kept as an informational device spike only.

For the Phase 2 gesture:

- **G1. Draw a new box over an outline of the current one** (first implementation). Rejected on device: not
  intuitive, and it needs an intermediate one-button panel.
- **G2. Corner handles only.** Simpler targets, but no single-axis stretch.
- **G3. Eight handles + move, Cancel/Done (chosen).**

## Decision

**D1 — Keep aspect ratio checkbox.** The Shapes popup gains a "Keep aspect ratio" checkbox, unchecked by default
(identical to v1.0.11). When checked, a dragged shape is scaled uniformly to the largest size that fits inside the
box and centred in it (`fitRectUniform`). Taps, Lines (pen-down → pen-up) and Circles (already uniform) are
unaffected. `placeGeometry` takes a defaulted options object `{keepAspect?}` so every existing caller is unchanged.

**D2 — Preference persistence.** The checkbox value is stored under `@snshapes_preferences` in a versioned envelope by
`preferencesStorage.ts`, reusing `favoritesStorage`'s AsyncStorage-or-memory backend resolution. AsyncStorage is not
currently installed, so the value persists per JS-engine lifetime, exactly like favorites. A toggle made before
hydration completes wins over the loaded value.

**D3 — Lasso button.** A type-2 lasso-toolbar button, id 200, named "Shapes", `editDataTypes: [5]` (5 = geometric
shapes per `PluginEditButton`; no `showType` is passed — the host fills `showType=1`). Confirmed on device: it lists in
the main lasso toolbar row (`menuLevel=1`) only for geometry selections. `App.tsx` routes by button id via
`viewForButtonId`. Only the lasso view is keyed on the button session, so each lasso press re-reads the selection
while the palette keeps its state. After subscribing, `App` re-reads the router's last event so one delivered between
the first render and the subscription is not lost.

**D4 — Straight into resize (supersedes the one-button Edit Shape panel).** The lasso button opens the resize screen
directly. `ShapeOptionsPanel` reads counts, geometries, lasso rect and page size in parallel; until they resolve it
shows a small "Loading…" card (✕ closes; nothing has been written). Exactly one geometry and nothing else
(`isSingleGeometrySelection`) opens the handles; anything else shows "Select a single shape to resize."; a single
geometry whose bounds cannot be resolved or whose points all coincide shows "Can't resize this shape." A failed or
malformed geometry read (any malformed entry) shows "Couldn't read the lassoed shape." An unexpected error while
setting up is logged (`[EDIT_SHAPE] setup failed`) and shows "Can't resize this shape." The old re-style pickers and
Delete remain removed (the popup sets style at insert; the firmware lasso deletes).

While the handles are up, the firmware lasso box is hidden (`setLassoBoxState(1)`) so only our box shows. It is shown
again (`setLassoBoxState(0)`) before every way out: Cancel, an unchanged Done, a successful write, and unmount. A failed
write keeps it hidden, because the handles stay up for a retry. The calls are issued synchronously, never awaited and
never throw; each result is logged as `[EDIT_SHAPE] lassoBox`. DEVICE-UNVERIFIED.

**D5 — Handle gesture (supersedes the draw-a-new-box gesture).** A full-screen responder (`ResizeHandlesOverlay`)
shows the shape's box with eight 14 dp filled handles: corners stretch both axes freely, edges one axis, a drag inside
the box moves it. A `straightLine` shows two endpoint handles joined by a segment; each endpoint drags freely. A bar
with **Cancel**, a hint and **Done** sits on whichever side of the screen, top or bottom, has more clearance from the
drawn handles (top on a tie, so a shape as tall as the page keeps its bottom handles reachable). Hit-testing and drag
math are pure (`resizeHandles.ts`): the pen grabs a handle within 40 page px (shrinking on small boxes). Priority is
centre → corner → edge → inside: within half the hit distance of the centre is always move, so a tiny box can still be
moved; a corner grows it. Drags are computed absolutely from the pen-down snapshot, so the 40 ms render throttle cannot
drift the result, and the release applies the exact final position. Sides stop the minimum side short of the opposite
side (no flip), and a dragged line endpoint stops the minimum side from the other endpoint; boxes and endpoints stay on
the page without jumping when the start box is already slightly off-page. A shape with a zero-size axis (a flat
polygon) offers only the handles along its other axis (`boxHandles`), and a box squashed to zero on an axis the shape
has is rejected. Nothing is written until Done. Cancel, or Done with an unchanged box (compared on the
edit, before any geometry math), closes without calling `modifyLassoGeometry`.

**D6 — Starting box and write.** `N` is the geometry's stored vertex box (`geometryNaturalBounds`); `L` is the lasso
rect (visual: stroke padding, plus any pending native-handle resize or move from the same lasso session, which
`getLassoGeometries` does not reflect). With `tol = defaultLassoTolerance(penWidth)`, the lasso shows a pending native
edit only when its size differs from `N` by more than `2·tol` on either axis, or its centre is more than `tol` from
`N`'s on either axis. Padding is roughly symmetric — even when a sharp vertex (a star, a thin triangle) pushes one side
past `tol` — so it cannot trip either test, while a native resize or move does. Without a pending edit the handles open
on `N`. With one they open on `L` inset by half that tolerance per side (capped at a quarter of each side; a flat axis
stays collapsed onto `L`'s centre), i.e. on the estimated visual vertex box. Either way the geometry written is `N`
remapped straight onto the final box (`applyRectTransform(g, N, final)`): axis-aligned remaps compose, so a pending
native edit is baked in. An unchanged Done writes nothing and is exact. After a native resize or move the start box is
an estimate, so a Done that moves only some sides may shift the untouched ones by the estimate error: at most about
`tol / 2` minus the real padding, e.g. ~5 px at pen width 900. A line writes its two endpoint
handles as its points. The full geometry is re-sent, so pen props go back with the new coordinates; the stroke is
rewritten at the stored pen width (a natively scaled stroke snaps back to it). Success closes the plugin view.
Failure — including `success: true` with `result: false`, which the SDK documents as "update failed" — shows the
error in the bar for 2 s and keeps the handles where the user left them, so Done can be retried. Cancel, Done and new
gestures are ignored while the write is in flight. A `[EDIT_SHAPE] frame` log line records `N`, `L`, the pending flag
and the start box.

**D7 — Circles and ellipses.** A circle stretched unevenly is written as `GEO_ellipse` (identical fields); an even
stretch keeps `GEO_circle` (relative epsilon). A rotated ellipse cannot represent a non-uniform scale exactly and is
approximated by `applyRectTransform`: the centre lands on the box centre and type and angle are kept.

**D8 — Selection strictness.** Any positive non-geometry count (`trailNum`, `titleNum`, a text box, a link...) refuses
the selection, whether or not `geometryNum` is present. With a numeric `geometryNum` it must also be 1. Only counts that
carry no evidence of other elements and no numeric `geometryNum` degrade, deliberately, to "the geometry list has one
entry", with a warning: only the lassoed geometry is ever rewritten, never a stroke. Confirmed on device: a lone shape
reports `{"polygonNum":1,"geometryNum":1}` and the firmware omits zero counts (no `trailNum` key), so the strict path
applies; two shapes report `geometryNum: 2` and are refused.

**D9 — Shared page context.** `resolvePageSize`, the default page size and `TOUCH_SCALE` live in `src/pageSize.ts`,
shared by the palette and the lasso view. `ShapePalette` re-exports the defaults.

**D10 — Docs.** ADR-PEN-PLACEMENT D3 and the README stop claiming the native lasso scales per axis, and describe the
checkbox and the handle resize.

## Consequences

- The Reddit request is met at both points the plugin controls; the firmware handle is unchanged.
- Resizing from the lasso rewrites the stroke at the stored pen width instead of letting the firmware scale it,
  which removes the #5 / #15 drift for that path.
- Pure code (`fitRectUniform`, `pageToTouch`, `countsAreUsable`, `isSingleGeometrySelection`,
  `defaultLassoTolerance`, `resizeFrame`, `boxHandles`, `hitTest`, `dragHandle`, `editsEqual`, `applyResize`) is
  host-tested in
  isolation; `ResizeHandlesOverlay`, `ShapeOptionsPanel` and `App` are covered by component tests. `index.js` stays an
  uncovered device shell.
- `resizeGeometryTo`, the `referenceRect` outline on `PlacementOverlay`, the tap hint and the one-button panel from the
  first implementation are removed.
- Phase 2 remains a separable run of commits; its docs must be trimmed by hand if it is reverted.
- Confirmed on device (2026-09-24): counts shape for a lone shape and for two shapes; button listing and routing;
  `modifyLassoGeometry` returning `{"success":true,"result":true}`; drag and tap insert.
- Still to confirm on device:
  - the firmware lasso box hides when the handles come up and comes back after Cancel, an unchanged Done and a
    successful write (`[EDIT_SHAPE] lassoBox`);
  - `[EDIT_SHAPE] frame` shows `pending:false` on a fresh lasso of a star and of a thin triangle; `pending:true` after a
    native resize and after a native move, with the handles lined up on the visible shape;
  - that `getLassoGeometries` still returns pre-resize coordinates after a native resize on current firmware;
  - handle size and hit area with the pen (including moving a tiny shape by its centre), legibility of the 40 ms box
    updates, and which side the bar takes on a tall shape;
  - Cancel and unchanged Done write nothing; circle → ellipse accepted; colour, width and pen type kept; shape +
    handwriting refused.
- Out of scope: changing the native handle; multi-shape resize; rotating; moving a line as a whole;
  `resizeLassoRect`.
- `boundsMatch`, restored for the first start-box rule, is removed again: the size/centre rule replaced it.

## Implementation notes (handle rework)

Small departures from the design sketch, each the minimal sound fix:

- `applyResize(g, edit)` recomputes `N` from `g` instead of taking it as a parameter, so the write is stored → edited
  by construction and a caller cannot pass a mismatched source box. `ResizeFrame` carries `pending` for the
  `[EDIT_SHAPE] frame` probe.
- A side's drag range always includes its start position: a box already narrower than the minimum side cannot shrink
  further, but it never jumps outward when grabbed.
- `resizeFrame` and `applyResize` also refuse a geometry with any non-finite point, which `geometryNaturalBounds` alone
  can miss.
- The unchanged-Done check and `applyResize` receive the geometry and frame from the render that drew the handles,
  so there is no unreachable "not resizing" branch.
- An edge's hit area reaches the hit distance past its ends, so a flat box's end handles (whose side has no length)
  can be grabbed.

## Revision history

- 2026-09-24 (initial): Edit Shape panel with one action, **Resize freely**, which drew a replacement box over a 1 px
  outline of the current bounds (`resizeGeometryTo`, `referenceRect`).
- 2026-09-24 (revised after on-device testing): owner found drawing a replacement box unintuitive. D4/D5 replaced by
  straight-into-resize with handles; D6 added (starting box and write); `boundsMatch` / `defaultLassoTolerance`
  restored for start-box detection; device findings recorded in D3 and D8.
- 2026-09-24 (review of the handle rework): pending detection by size (> 2·tol) or centre offset (> tol) instead of
  any side beyond tol, so sharp shapes on a fresh lasso open on their stored box and a native move is caught; bar on the
  side with more clearance; firmware lasso box hidden while the handles are up; mixed counts refused even without
  `geometryNum`; separate "Couldn't read the lassoed shape." message; a centre move area for tiny boxes; flat shapes
  offer one axis; line endpoints kept apart; setup errors caught.
