# ADR-3D-SHAPES: Pseudo-3D shapes as single-geometry oblique wireframes

- Status: accepted (implemented on `feat/3d-shapes`; on-device validated)
- Date: 2026-06-03
- Deciders: SnShapes (owner: J-Raghavan)
- Spec: `spec/SPEC-ADD-3D-SHAPES.md` (F1–F8, + v0.5 full-wireframe redesign)
- Supersedes deviation: v1.0.4 removed the multi-primitive 3D shapes (cube/cylinder/axes); this revives 3D with a different, single-geometry mechanism.

> **Outcome (v0.5, on-device validated):** the five solids ship as full see-through
> **wireframes** (all edges incl. hidden, same `penColor`). On-device testing confirmed the
> firmware renders self-touching/retracing single polygons correctly — so the wireframe
> mechanism (D1) holds. Two findings refined the design: a visible-edges-only first cut read
> as "incomplete," and a cylinder closing-seam **chord** bug slipped past topology tests —
> fixed, and guarded by new **geometric-feature tests** (anti-chord, full-ellipse). Different-
> colour/dashed hidden faces remain out of scope (one `penColor` per geometry; 2 elements
> would reintroduce the v1.0.4 multi-element problem). Sphere, torus/ring, ¼-cut sphere
> evaluated and dropped (don't read clearly at icon size / need a 2nd loop).

## Context and Problem Statement

There is a request to add 3D shapes (cone, cylinder, cube, sphere, half-sphere, …) to the
palette. SnShapes inserts shapes onto a Supernote note via the firmware geometry model, and
the codebase carries a hard lesson about how 3D shapes must be built.

**The earlier 3D shapes were removed in v1.0.4.** They were composites of multiple
primitives and were inserted via an `insertImage` fallback that **baked the strokes into a
PNG** — so pen colour, width, rotation, and single-element lasso all stopped applying. The
rationale is recorded verbatim in `src/ShapePalette.tsx` (~line 336): the firmware
(Chauvet 3.27.41) "has no grouping primitive," and the baked-bitmap shapes read as "these
controls silently do nothing here." Dropping them was the honest fix.

**The governing constraint** is therefore: every shape's `build()` must return **exactly
one** `Geometry` (`ShapeBuildResult = Geometry`, `src/shapes.ts:175`), so the inserted
element is a real, recolourable, single-lasso-selectable stroke. The firmware exposes only
four geometry primitives — `GEO_polygon` (a single closed vertex list), `GEO_circle`,
`GEO_ellipse`, `straightLine` (`src/shapes.ts:49`) — with **no fill** (only `penColor`,
verified against the latest `sn-plugin-lib` 0.1.43 `model/Element.d.ts`) and **no native
arc** primitive.

The problem: 3D solids are inherently multi-edged/multi-curve. How do we render them while
honouring the one-geometry rule that the v1.0.4 removal established?

## Decision Drivers

- **Single-geometry integrity** — the inserted shape must recolour, resize, rotate, and
  lasso as one element (the exact capability the v1.0.4 image fallback lost).
- **e-ink legibility** — recognizable at the 48-px palette size and as page strokes.
- **Reuse** — the existing `build()` contract, `makePolygon`/`arcPoints`/`regularPolygon`,
  the carousel, favorites, `render-icons`, and `PluginCommAPI.insertGeometry` must be reused;
  no new insert path.
- **Honesty over coverage** — ship only shapes that read as genuinely 3D; do not ship shapes
  that are indistinguishable from an existing 2D shape or that need fill to read.

## Decisions

### D1 — Mechanism: one `GEO_polygon` wireframe per solid (NOT multi-geometry, NOT image-insert)
Render each solid as a **single closed `GEO_polygon`** — one continuous pen stroke that
never lifts and closes, an Eulerian-style traversal of the visible wireframe that **retraces**
the minimum number of edges needed to make all vertex degrees even (the classic "draw a cube
without lifting the pen"). Retraced edges are drawn twice; on e-ink this is visually
invisible. This keeps every solid a real, single geometry — so colour/width/rotation/lasso
all apply.
- **Rejected — multi-geometry composite (the pre-v1.0.4 approach):** the firmware has no
  grouping primitive; inserting N geometries yields N independently-lassoable strokes, and
  the `insertImage` workaround baked them into a PNG that ignored the pen controls
  (`src/ShapePalette.tsx` ~336). This is the documented failure we are reversing.
- **Rejected — fill/shaded solids:** impossible. The `Geometry` model has no `fill`/
  `fillColor` (only grayscale `penColor`), confirmed in 0.1.43. 3D shapes are wireframe
  outlines only.

### D2 — Projection: oblique / cabinet (NOT isometric)
Draw the front face axis-aligned and the depth as a single parallel offset vector
`D = {dx: depth·depthScale·cosθ, dy: -depth·depthScale·sinθ}` (default θ=30°, depthScale≈0.7).
- **Why:** an axis-aligned front face reads as "settled" on a ruled page and maps trivially
  to `width`/`height` params; the back face is simply `front + D`, which makes the
  single-stroke retrace path easy to construct. There is precedent — the existing
  `parallelogram` already fakes a slant with an `offset`.
- **Rejected — isometric (all axes at 120°/30°):** looks more "correct" but no face is
  axis-aligned, the vertex centroid drifts far from the page centre, and it reads as
  tilted/unstable at thumbnail scale next to the flat 2D primitives.

### D3 — Curved caps via a new `ellipseArcPoints` polyline sampler
Cylinder and cone caps are foreshortened ellipses that must be part of the single polygon
loop, so they cannot use the native `GEO_ellipse` (that would be a second geometry).
Approximate them as polygon vertices via a new internal helper `ellipseArcPoints(center, rx,
ry, start, end, segments)` — a y-scaled clone of the existing `arcPoints` (`src/shapes.ts:341`).
- **Why a new helper:** `arcPoints` only samples **circular** arcs (equal radius); the caps
  need `ry < rx`. It is a ~4-line generalization and the only genuinely new helper concept.
- **Rejected — native `GEO_ellipse` for caps:** would force a second geometry (violates D1).

### D4 — Shape set: ship the "Core 5"; exclude sphere and torus
Ship **cuboid, cube, square pyramid, cylinder, cone**. Cube is a preset of the cuboid
builder (`size` = width = height = depth), following the existing `blockArrow`/`thickArrow`
shared-builder precedent.
- **Rejected — sphere:** its only honest single-stroke silhouette is a circle; the 3D cue
  (an interior equator ellipse) is a second geometry, and without fill it is indistinguishable
  from the existing `circle` shape. Users wanting a sphere use `circle`.
- **Rejected — torus:** needs two concentric ellipses (2 geometries); forced into one polygon
  it grows a visible connector "spoke" and reads as an annulus — a niche `refreshArrow`
  already occupies.
- **Deferred — triangular prism, dome/half-sphere:** feasible as single polygons (Tier B) but
  busier at thumbnail scale; out of the Core 5, revisit on demand.

### D5 — New `threeD` category; reuse the existing pipeline unchanged
Add a `threeD` category via the established three-edit pattern (`ShapeCategory` union
`src/shapes.ts:116`, `CATEGORY_ORDER` `:130`, `CATEGORY_LABELS` `:139`). The shapes are
ordinary `SHAPES` entries with `geometryType: 'GEO_polygon'`; insertion, lasso, the carousel,
favorites, and icon generation are reused verbatim — the only new runtime code is geometry
construction in `src/shapes.ts`. The library upgrade `sn-plugin-lib` 0.1.34 → 0.1.43 (spec
F1) is a separate, non-breaking prerequisite (the `Geometry` model is byte-identical between
those versions).

## Consequences

- **Good:** restores 3D shapes the right way — each solid is a real geometry, so colour,
  width, rotation, and single-element lasso all apply (the v1.0.4 failure does not recur).
  Reuses the entire insert/lasso/icon pipeline; adds four small internal geometry helpers
  (`obliqueDepth`, `buildBoxPoints`, `buildPyramidPoints`, and the one genuinely new concept
  `ellipseArcPoints`) and one category.
- **Cost / known artifacts:** wireframe-only (no fill — a firmware limitation, not a choice);
  oblique solids may read as slightly "tilted" to some users; foreshortened caps approximated
  as polylines can show faint faceting at large radius (mitigated by segment-count tuning, as
  existing arrow arcs already do); the vertex centroid is offset from page centre by ~`D/2`,
  so 3D shapes must use a bounding-box centering assertion, not a vertex-average one (spec
  F8-FR3).
- **Reversibility:** isolated behind the new `threeD` category and additive `SHAPES` entries;
  any shape (or the whole category) can be removed without touching the 2D shapes or the
  insert path.
- **Scope guard:** sphere and torus are explicitly not added; triangular prism and dome are
  deferred.

## More Information

- Spec: `spec/SPEC-ADD-3D-SHAPES.md` (F1–F8, with vertex sketches, parameters, and tests).
- Code: `src/shapes.ts` — `Geometry` union (`:49`), `ShapeBuildResult` (`:175`), helpers
  `regularPolygon` (`:281`), `arcPoints` (`:341`), `makePolygon` (`:359`); category pattern
  (`:116`/`:130`/`:139`). `src/ShapePalette.tsx` — `insertGeometry` (`:362`) and the v1.0.4
  multi-primitive removal rationale (~`:336`).
- Library: `sn-plugin-lib` `model/Element.d.ts` — `Geometry` has `penColor/penType/penWidth`
  only (no fill); verified in 0.1.43.
- Method: single-stroke wireframe = Eulerian path with doubled (retraced) edges to even all
  vertex degrees.
