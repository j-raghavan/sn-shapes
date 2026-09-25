# ADR-FREE-RESIZE: Keep-aspect choice at insert, free resize from the lasso

- Status: accepted (approved by owner 2026-09-24; implemented on `feat/issue-17-free-aspect-resize`)
- Date: 2026-09-24
- Deciders: SnShapes (owner: J-Raghavan)
- Spec: `spec/SPEC-FREE-RESIZE.md` (FR1–FR9) (local, uncommitted per repo convention: spec/ is gitignored)
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
- Reuse `placement.ts`, `lassoTransform.ts`, `PlacementOverlay` and the retained `ShapeOptionsPanel`; no parallel
  gesture or transform code.
- Pure logic host-tested; firmware-dependent steps isolated and listed for on-device confirmation.
- Phase 2 must be removable without touching Phase 1.

## Considered Options

- **A. Popup checkbox only.** Small and fully host-testable, but a placed shape still cannot be reshaped.
- **B. Lasso button only.** Reshapes placed shapes, but depends on several unverified firmware behaviours and leaves
  the insert-time drag undiscoverable.
- **C. Both, in separable commits (chosen).**
- **D. `resizeLassoRect` with a non-uniform rect.** Cheapest for Phase 2, but the firmware would scale the stroke and
  it is unknown whether it honours a non-uniform rect. Kept as an informational device spike only.

## Decision

**D1 — Keep aspect ratio checkbox.** The Shapes popup gains a "Keep aspect ratio" checkbox, unchecked by default
(identical to v1.0.11). When checked, a dragged shape is scaled uniformly to the largest size that fits inside the
box and centred in it (`fitRectUniform`). Taps, Lines (pen-down → pen-up) and Circles (already uniform) are
unaffected. `placeGeometry` takes a defaulted options object `{keepAspect?}` so every existing caller is unchanged.

**D2 — Preference persistence.** The checkbox value is stored under `@snshapes_preferences` in a versioned envelope by
a new `preferencesStorage.ts`, reusing `favoritesStorage`'s AsyncStorage-or-memory backend resolution. AsyncStorage is
not currently installed, so the value persists per JS-engine lifetime, exactly like favorites. A toggle made before
hydration completes wins over the loaded value.

**D3 — Lasso button.** A type-2 lasso-toolbar button, id 200, named "Shapes", `editDataTypes: [5]` (5 = geometric
shapes per `PluginEditButton`; the same registration, payload included, was verified on Chauvet 3.27.41 in April
2026, so no `showType` is passed). It opens the "Edit Shape" panel (`ShapeOptionsPanel.tsx`, revived). `App.tsx`
routes by button id via `viewForButtonId`. Only the Edit Shape panel is keyed on the button session, so each lasso
press re-reads the selection while the palette keeps its state across sidebar presses. After subscribing, `App`
re-reads the router's last event so one delivered between the first render and the subscription is not lost.

**D4 — Edit Shape panel.** One action: **Resize freely**. The panel reads counts, geometries, lasso rect and page size
in parallel. It is enabled only for exactly one geometry and nothing else (`isSingleGeometrySelection`); otherwise it
shows "Select a single shape to resize." Counts without a numeric `geometryNum` (failed read or missing field) degrade,
deliberately, to "the geometry list has one entry" with a `[EDIT_SHAPE] counts unavailable` warning: only the lassoed
geometry is ever rewritten, never a stroke, so the worst a missed mixed selection can do is stretch that one shape. A
rect read that fails or has any non-finite side degrades to the geometry's natural bounds. A geometry list with any malformed entry counts as unreadable, so
it can never pass the single-shape check. The old re-style pickers, Delete and their helpers are removed: the popup
sets style at insert and the firmware lasso already offers delete. With them go `bakeLassoResize`, `boundsMatch` and
`defaultLassoTolerance` from `lassoTransform.ts`, whose only consumer they were (see D5).

**D5 — Resize gesture.** Resize freely switches the panel to a full-screen `PlacementOverlay` showing the current bounds
as a static 1 px outline (`referenceRect`, distinct from the 2 px live rubber band) and a hint bar with ✕. The outline
is the lasso rect, which includes stroke padding, so a box drawn over it yields a slightly larger shape by design. A
drag defines the new box; a tap briefly changes the hint to "Drag to draw the new size". `resizeGeometryTo` (in
`placement.ts`, beside `placeGeometry`) takes the drag target: a line follows the pen from pen-down to pen-up exactly
as at insert (shared `followPen`); anything else has its stored natural bounds remapped absolutely onto the box
(`applyRectTransform`), the same vertex-bounds convention as the insert-time drag. A geometry whose points all
coincide cannot be stretched and reports "Can't resize this shape". The result is written with `modifyLassoGeometry`,
re-sending the full geometry including pen props. The remap starts from the geometry's *stored* coordinates, so a
pending native lasso resize (not reflected by `getLassoGeometries`) is replaced rather than baked in first. The stroke
is rewritten at the shape's stored pen width (the width picked at insert): after a native handle resize the
firmware-scaled stroke may snap back to that stored width. Success closes the plugin view. Failure — including
`success: true` with `result: false`, which the SDK documents as "update failed" — returns to the panel with an
error banner and leaves the shape untouched. Every close path is ignored while the modify is in flight.

**D6 — Circles.** A circle stretched unevenly is written as `GEO_ellipse` (identical fields). A uniform stretch keeps
`GEO_circle`. The comparison uses a relative epsilon. A rotated ellipse cannot represent a non-uniform scale exactly, so
it is approximated (see `applyRectTransform`): the centre lands on the box centre and the type and angle are kept.

**D7 — Selection strictness.** With usable counts, `geometryNum` must be 1 and `trailNum` (and every other numeric
non-geometry count) 0: a mixed selection would stretch only the geometry against a box drawn around several elements.
The panel logs `[EDIT_SHAPE] counts` so the rule can be relaxed if the firmware turns out to count geometries in
`trailNum`. Unusable counts fall back as described in D4.

**D8 — Shared page context.** `resolvePageSize`, the default page size and `TOUCH_SCALE` move from `ShapePalette.tsx` to
`src/pageSize.ts` so the palette and the panel share one implementation. `ShapePalette` re-exports the defaults.

**D9 — Docs.** ADR-PEN-PLACEMENT D3 and the README stop claiming the native lasso scales per axis, and describe the
checkbox and Resize freely.

## Consequences

- The Reddit request is met at both points the plugin controls; the firmware handle is unchanged.
- Resize freely rewrites the stroke at the stored pen width instead of letting the firmware scale it, which also
  removes the #5 / #15 drift for that path.
- New pure code (`fitRectUniform`, `pageToTouch`, `resizeGeometryTo`, `countsAreUsable`,
  `isSingleGeometrySelection`) is host-tested in
  isolation; `ShapeOptionsPanel` and `App` are covered by component tests. `index.js` stays an uncovered device shell.
- Phase 2 (FR4–FR8) is a separate run of commits and can be reverted without touching Phase 1.
- On-device confirmation required before merge:
  - **(top priority)** what `trailNum` / `geometryNum` report for a lone lassoed shape (`[EDIT_SHAPE] counts`);
  - which `penWidth` `getLassoGeometries` reports after a native handle resize;
  - whether `modifyLassoGeometry` ever returns `success: true` with `result: false`;
  - whether the 1 px outline and the 2 px rubber band are legible and distinct on e-ink;
  - button visibility and placement; lasso staying active while the plugin is open; `modifyLassoGeometry` keeping
    pen props and applying coordinates; circle → ellipse type change accepted; lasso box after close; outline
    alignment; checkbox row layout.
- Out of scope: changing the native handle; multi-shape resize; re-style/delete from the lasso panel;
  `resizeLassoRect`.
