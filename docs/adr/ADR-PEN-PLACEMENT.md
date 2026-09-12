# ADR-PEN-PLACEMENT: Place and size shapes with the pen on the overlay

- Status: accepted (approved by owner 2026-09-12; implemented on `fix/issue-15-pen-placement`)
- Date: 2026-09-12
- Deciders: SnShapes (owner: J-Raghavan)
- Spec: `spec/SPEC-PEN-PLACEMENT.md` (F1–F3) (local, uncommitted per repo convention: spec/ is gitignored)
- Issue: #15 (pierrewjohnson) — "Minor functional choices differences"

## Context and Problem Statement

Issue #15 reports three things on Chauvet 2.26.41 (A5X) / 3.29.44 (Nomad):

1. The shape is inserted at the page centre; the reporter wants it under the pen tip.
2. Stroke thickness "seems to depend on the size of the box drawn", not only on the
   Stroke Width preset.
3. One unreproduced case of a rectangle vanishing after insert.

Today `insertShape` (`src/ShapePalette.tsx`) hard-codes the centre as half the page size
resolved via `PluginFileAPI.getPageSize`, and every shape is inserted at its fixed default
parameters (e.g. rectangle 200×200 px). The commit gesture is already "pen down on the
full-screen overlay outside the panel", but the touch coordinates are discarded.

Point 2 is a consequence of point 1's design: because the inserted size is fixed, users
resize with the native lasso handle, and the firmware scales stroke width together with the
geometry on lasso resize. The plugin cannot intercept that. The only in-plugin remedy is to
insert the shape at the wanted size so no post-insert resize is needed.

Point 3 cannot be reproduced from the report. The insert path already fails loudly on a
non-success response, so no behavioural fix is justified.

## Decision

**D1 — One gesture, two outcomes.** The commit gesture stays "pen down outside the panel".
If the pen lifts within `DRAG_THRESHOLD_PX` of where it went down, it is a **tap** and the
shape is inserted at its default size centred on the touch point. Otherwise it is a
**drag** and the shape is fitted into the box swept from pen-down to pen-up. There is no
mode switch and no new button. The ✕ button remains the only cancel.

**D2 — Coordinate mapping.** Touch coordinates arrive from React Native in dp
(`nativeEvent.pageX/pageY`). Geometry points are documented by `sn-plugin-lib`
(`model/Element.ts`, `Geometry.points`) as *Android screen coordinates*. We therefore map
dp → page px with `PixelRatio.get()` and assume the plugin root view origin is the screen
origin. This is the same assumption the current centre computation makes (page size ==
screen size, verified on Nomad/A5X by #14). The mapping is a single injectable scale factor
so the pure logic is host-testable; the factor itself is DEVICE-UNVERIFIED until the owner
confirms on hardware.

**D3 — Sizing by reuse.** Drag sizing reuses `geometryNaturalBounds` + `applyRectTransform`
from `src/lassoTransform.ts`: build the geometry at default params, then map its natural
bounds onto the target rect. Polygons, ellipses and lines scale freely per axis (this is
what the native lasso does, so it matches the user's mental model). `GEO_circle` scales
uniformly to the shorter side and is centred in the box so a circle stays a circle.
`applyRectTransform` is extended (additively, default-compatible) so a degenerate source
axis (the horizontal Line has zero height) is translated instead of leaving the geometry
unchanged. A dragged `straightLine` does not use the box at all: its points become the
clamped pen-down and pen-up points in gesture order (`from`/`to` on the drag target), so a
line follows the pen rather than a box diagonal or midline.

**D4 — Bounds.** The drag rect is normalised (any corner order) and clamped to the page
before fitting; each side is floored at `MIN_DRAG_SIDE_PX` around its own midpoint. A tap
placement is translated so the shape's natural bounds stay inside the page; a shape larger
than the page is aligned to the page origin.

**D5 — Rubber band.** During a drag a 2 px solid black, non-interactive `View` outlines the
box in overlay dp coordinates (solid, not dashed: e-ink partial refresh drops dash
segments). Updates are throttled to one per ~40 ms; the release path clears the band
unconditionally. It is feedback only; the insertion logic does not depend on it, so it can
be removed if it ghosts on e-ink without touching D1–D4.

**D6 — Responder, not Pressable.** The overlay uses the React Native gesture responder
props (`onStartShouldSetResponder`, `onResponderGrant/Move/Release/Terminate`) because
`Pressable.onPress` carries no move stream. The panel remains a `Pressable` and therefore
claims touches that start inside it, so the overlay only ever sees touches outside the
panel, exactly as today.

**D7 — Point 3.** Log the `insertGeometry` response at info level so a future report
carries logcat evidence. No other change.

**D8 — Copy.** The panel footer hint, `PluginConfig.json`/`package.json` descriptions and
the README stop promising "centered" shapes and describe tap-to-place / drag-to-size.

## Consequences

- Point 1 fixed directly; point 2 fixed at its only controllable point (insert size).
- Users who keep tapping get the old behaviour with a better position; nothing is lost.
- New pure module `src/placement.ts` carries all gesture → geometry logic and is covered in
  isolation. `ShapePalette.tsx` grows only by the responder handlers and the rubber band.
- Manual on-device confirmation of D2 (dp→px scale, root-view origin) and D5 (e-ink
  behaviour of the rubber band) is the final gate; it is called out in the PR.
- Out of scope: firmware stroke scaling on lasso resize; zoomed/scrolled page views (the
  existing centre logic had the same limitation); the unreproduced disappearance.
