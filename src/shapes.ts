export type Point = {x: number; y: number};

export type PenStyle = {
  penColor: number;
  penType: number;
  penWidth: number;
};

/**
 * Flags common to all Geometry variants but independent of the shape's
 * visual definition. Kept separate from PenStyle so shape builders don't
 * need to think about them.
 *
 * showLassoAfterInsert: when true, sn-plugin-lib's insertGeometry will
 *   automatically activate the lasso selection on the inserted shape.
 *   Backed by the field of the same name on the library's Geometry class
 *   (see node_modules/sn-plugin-lib/src/model/Element.ts).
 */
export type GeometryFlags = {
  showLassoAfterInsert?: boolean;
};

export type PolygonGeometry = PenStyle & GeometryFlags & {
  type: 'GEO_polygon';
  points: Point[];
};

export type CircleGeometry = PenStyle & GeometryFlags & {
  type: 'GEO_circle';
  ellipseCenterPoint: Point;
  ellipseMajorAxisRadius: number;
  ellipseMinorAxisRadius: number;
  ellipseAngle: number;
};

export type EllipseGeometry = PenStyle & GeometryFlags & {
  type: 'GEO_ellipse';
  ellipseCenterPoint: Point;
  ellipseMajorAxisRadius: number;
  ellipseMinorAxisRadius: number;
  ellipseAngle: number;
};

export type LineGeometry = PenStyle & GeometryFlags & {
  type: 'straightLine';
  points: Point[];
};

export type Geometry = PolygonGeometry | CircleGeometry | EllipseGeometry | LineGeometry;

export type ShapeId =
  // Basic primitives (v1.0.3)
  | 'rectangle'
  | 'circle'
  | 'roundedRect'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'heptagon'
  | 'octagon'
  | 'line'
  | 'parallelogram'
  // Arrows (v1.0.4) — every arrow is authored as a single closed
  // polygon (not "shaft line + triangle tip") so the firmware lasso
  // grabs the whole arrow as one object after insert, and on-page
  // re-styling (pen colour / width) applies to the outline uniformly.
  // Ball / chevron-tail / refresh are the v1.0.4 replacements for the
  // dropped 3D wireframes — visually richer but still vector-single.
  | 'blockArrow'
  | 'doubleArrow'
  | 'thickArrow'
  | 'ballArrow'
  | 'chevronTailArrow'
  | 'refreshArrow'
  // Flowchart symbols (v1.0.4). `flowchartTerminator` is the
  // start/end pill; `flowchartManualInput` is the slanted-top
  // parallelogram used for keyboard/input steps.
  | 'flowchartPreparation'
  | 'flowchartDocument'
  | 'flowchartTerminator'
  | 'flowchartManualInput'
  // Decorative (v1.0.4) — certificate / ribbon / banner / starburst /
  // awardBadge. All single closed polygons, so styling + rotation behave
  // like basic primitives. Replaces the earlier 3D-wireframe /
  // curved-arrow set that had to insert as bitmaps and lost
  // pen-colour / width control.
  //
  // `starburst` is the retail "SALE" sticker — an ellipse with
  // alternating inner/outer radii. `awardBadge` is a medallion with
  // two diverging V-notched ribbon tails (twin tails splay outward
  // rather than cross so the polygon stays simple / non-self-intersecting
  // — see its build() comment for the boundary walk).
  | 'certificate'
  | 'ribbon'
  | 'banner'
  | 'starburst'
  | 'awardBadge'
  // Others (v1.0.4) — the misc bucket.
  | 'plus'
  | 'lightning'
  | 'trapezoid'
  // 3D solids (v0.4) — oblique single-polygon wireframes
  | 'cuboid'
  | 'cube'
  | 'squarePyramid'
  | 'cylinder'
  | 'cone';

/**
 * Shape groups surfaced in the palette's carousel header. The palette
 * renders shapes one category at a time and the user flips between them
 * with prev/next arrows — less visual clutter than a tab bar and fits the
 * e-ink page-flip idiom users already know from the firmware's reader UI.
 *
 * CATEGORY_ORDER is the authoritative cycle order. Adding a new category
 * is a two-line change (extend the union + append to CATEGORY_ORDER);
 * CATEGORY_LABELS is a Record<ShapeCategory, string> (not Partial) so
 * TypeScript catches missing labels at compile time.
 */
export type ShapeCategory =
  // 'favorites' is a user-curated, dynamically-populated bucket — no
  // shape declares `category: 'favorites'`. Membership comes from the
  // user's persisted favorites list (see favoritesStorage.ts) and is
  // resolved at render time via favoriteShapes(). Listed first in
  // CATEGORY_ORDER so one ◀ tap from the landing 'basic' group reaches
  // it without scrolling forward through every other category.
  | 'favorites'
  | 'basic'
  // 'threeD' is the pseudo-3D solids group (cuboid, cube, square
  // pyramid, cylinder, cone) — each a single GEO_polygon in oblique
  // (cabinet) projection. Placed immediately after 'basic' so the
  // solids sit next to the primitives they extend (OQ1, resolved).
  | 'threeD'
  | 'arrows'
  | 'flowchart'
  | 'decorative'
  | 'others';

export const CATEGORY_ORDER: readonly ShapeCategory[] = [
  'favorites',
  'basic',
  'threeD',
  'arrows',
  'flowchart',
  'decorative',
  'others',
];

export const CATEGORY_LABELS: Record<ShapeCategory, string> = {
  favorites: '♡ Favorites',
  basic: 'Basic Shapes',
  threeD: '3D Shapes',
  arrows: 'Arrows',
  flowchart: 'Flowchart',
  decorative: 'Decorative',
  others: 'Others',
};

export type ShapeParameter = {
  readonly id: string;
  readonly label: string;
  readonly defaultValue: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit: 'px' | 'deg' | '%';
};

/**
 * Build output: a single Geometry. Every shape in SHAPES is authored as
 * one closed polygon / circle / ellipse / line so it lands on-page as a
 * single lasso-able ink element and the user's PenStyle (colour + width
 * + pen type) applies to the whole shape uniformly.
 *
 * Multi-primitive composites were removed in v1.0.4 (2026-04-20). The
 * firmware (Chauvet 3.27.41) has no grouping primitive and supports
 * only single-element lasso, so inserting N geometries produced N
 * independently-lassoable ink blobs — a cylinder's four edges would
 * scatter when the user tried to move it. The interim image-insert
 * workaround turned those composites into raster stickers, but that
 * forfeited pen-colour / width and rotation, which was worse than not
 * offering the shapes at all. Replacement additions (ballArrow,
 * chevronTailArrow, refreshArrow, certificate, ribbon, banner) are all
 * single closed polygons.
 */
export type ShapeBuildResult = Geometry;

export type Shape = {
  readonly id: ShapeId;
  readonly label: string;
  /**
   * A shape can live in multiple groups (e.g. the rectangle is both a
   * Basic primitive and a Flowchart "process" box). Store as a single
   * value when there's only one group, or an array when cross-listed —
   * the palette normalises via `shapeCategories(shape)`.
   */
  readonly category: ShapeCategory | readonly ShapeCategory[];
  readonly parameters: readonly ShapeParameter[];
  /**
   * Static geometry discriminant — matches the `type` field that `build`
   * returns. Declared here so callers can inspect the geometry kind
   * without building a full Geometry object.
   */
  readonly geometryType: Geometry['type'];
  build: (center: Point, params: Record<string, number>, style: PenStyle) => ShapeBuildResult;
};

export const PEN_DEFAULTS: PenStyle = {
  penColor: 0x00,
  penType: 10,
  // Match the new M preset so the default width is highlighted in the
  // Shapes popup (WIDTH_PRESETS collapsed 9→5 on 2026-04-18; the old
  // 400 µm default no longer corresponds to any preset). Firmware
  // accepts any value ≥ MIN_PEN_WIDTH, so this is purely a UI default.
  penWidth: 500,
};

// ---------------------------------------------------------------------------
// Pen-style presets and helpers
// ---------------------------------------------------------------------------
// These constants and utilities live alongside PEN_DEFAULTS and PenStyle so
// that any component can import them without pulling in React Native UI code.
// They were originally defined in ShapeOptionsPanel.tsx; moved here so the
// shapes module is the single source of truth for all pen-style domain
// knowledge.

/** Firmware floor for penWidth (GeometrySchema.penWidth min in VerifyUtils.ts). */
export const MIN_PEN_WIDTH = 100;

/**
 * True iff `value` is a finite number at or above the firmware's penWidth
 * floor. Pure so it can be unit-tested directly without rendering.
 */
export function isAcceptablePenWidth(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_PEN_WIDTH
  );
}

// Pen-width presets. GeometrySchema.penWidth requires min: MIN_PEN_WIDTH;
// units are micrometres so `penWidth / 1000 = mm`. Five ticks labelled
// XS/S/M/L/XL — even spacing across the firmware-supported range.
export const WIDTH_PRESETS: ReadonlyArray<{value: number; mm: number; label: string}> = [
  {value: 100, mm: 0.10, label: 'XS'},
  {value: 300, mm: 0.30, label: 'S'},
  {value: 500, mm: 0.50, label: 'M'},
  {value: 700, mm: 0.70, label: 'L'},
  {value: 900, mm: 0.90, label: 'XL'},
];

export function formatPenWidthMm(penWidth: number | undefined): string {
  if (typeof penWidth !== 'number' || !Number.isFinite(penWidth)) {return '—';}
  return `${(penWidth / 1000).toFixed(2)} mm`;
}

// Pen-color presets: the five allow-listed grey levels from the firmware's
// PEN_COLORS constant in Constant.java. True white (0xFE/0xFF) is omitted
// because it is invisible on white paper.
export const COLOR_PRESETS: ReadonlyArray<{value: number; label: string; swatch: string}> = [
  {value: 0x00, label: 'Black',  swatch: '#000000'},
  {value: 0x9D, label: 'Dark+',  swatch: '#5A5A5A'},
  {value: 0x9E, label: 'Dark',   swatch: '#7A7A7A'},
  {value: 0xC9, label: 'Light',  swatch: '#B0B0B0'},
  {value: 0xCA, label: 'Light+', swatch: '#CCCCCC'},
];

/**
 * Map a firmware penColor byte to a CSS #RRGGBB preview swatch. Swatches
 * are tuned to the on-device visual density rather than the raw byte value.
 * Falls back to raw grayscale for bytes not in COLOR_PRESETS.
 */
export function penColorToSwatch(penColor: number | undefined): string {
  if (typeof penColor !== 'number' || !Number.isFinite(penColor)) {return '#000000';}
  const preset = COLOR_PRESETS.find(c => c.value === penColor);
  if (preset) {return preset.swatch;}
  const clamped = Math.max(0, Math.min(255, Math.round(penColor)));
  const hex = clamped.toString(16).padStart(2, '0').toUpperCase();
  return `#${hex}${hex}${hex}`;
}

// Pen-type presets from the firmware allow-list (Constant.java → PEN_TYPES).
// Order matches the sidebar pen order on Nomad so the mental model transfers.
export const PEN_TYPE_PRESETS: ReadonlyArray<{value: number; label: string}> = [
  {value: 10, label: 'Fineliner'},
  {value: 1,  label: 'Pressure'},
  {value: 11, label: 'Marker'},
  {value: 14, label: 'Calligraphy'},
];

export function regularPolygon(
  center: Point,
  radius: number,
  sides: number,
  startAngle = -Math.PI / 2,
): Point[] {
  if (sides < 3) {throw new Error(`regularPolygon requires at least 3 sides, got ${sides}`);}
  return Array.from({length: sides}, (_, i) => {
    const angle = startAngle + (2 * Math.PI * i) / sides;
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });
}

export function roundedRectPoints(
  center: Point,
  halfWidth: number,
  halfHeight: number,
  cornerRadius: number,
  segmentsPerCorner = 8,
): Point[] {
  const r = Math.min(cornerRadius, halfWidth, halfHeight);
  const corners = [
    {cx: center.x + halfWidth - r, cy: center.y - halfHeight + r, from: -Math.PI / 2, to: 0},
    {cx: center.x + halfWidth - r, cy: center.y + halfHeight - r, from: 0, to: Math.PI / 2},
    {cx: center.x - halfWidth + r, cy: center.y + halfHeight - r, from: Math.PI / 2, to: Math.PI},
    {cx: center.x - halfWidth + r, cy: center.y - halfHeight + r, from: Math.PI, to: (3 * Math.PI) / 2},
  ];

  return corners.flatMap(({cx, cy, from, to}) =>
    Array.from({length: segmentsPerCorner + 1}, (_, i) => {
      const angle = from + ((to - from) * i) / segmentsPerCorner;
      return {x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle)};
    }),
  );
}

function makeLine(p1: Point, p2: Point, style: PenStyle): LineGeometry {
  return {...style, type: 'straightLine', points: [p1, p2]};
}

/**
 * Sample a point list along a circular arc. Used by arrow shapes that
 * need to approximate an arc with polygon vertices — the firmware's
 * Geometry types don't have a native arc primitive, and GEO_polygon
 * requires a closed vertex list, so rounded silhouettes have to be
 * expressed as many-sided polygons.
 *
 * `segments` is the number of line segments (so the returned list has
 * `segments + 1` points). Angles are in radians, measured as in
 * regularPolygon (0 = +x, π/2 = +y in screen coords).
 *
 * Start/end angles do not need to be normalised: the helper interpolates
 * linearly so the caller can request a "long-way-around" sweep by
 * passing e.g. `startAngle = 0.5, endAngle = 2π - 0.5` — useful for
 * shapes that trace the majority of a circle's outline (ballArrow,
 * refreshArrow) and need to go the far side of the disc.
 */
export function arcPoints(
  center: Point,
  radius: number,
  startAngle: number,
  endAngle: number,
  segments: number,
): Point[] {
  // A circular arc is the equal-radii case of an elliptical one; delegate so
  // the sampling logic (and the segments guard) lives in one place.
  return ellipseArcPoints(center, radius, radius, startAngle, endAngle, segments);
}

/**
 * Sample a point list along an elliptical arc — the y-scaled analogue of
 * `arcPoints`. The firmware has no native arc primitive, so the
 * foreshortened circular caps of the 3D solids (cylinder / cone) have to
 * be expressed as polygon vertices on an ellipse with `rx !== ry`.
 *
 * Identical angle convention to `arcPoints` (0 = +x, π/2 = +y in screen
 * coords; start/end need not be normalised) and the same
 * `segments + 1` point count. With `rx === ry` the output is identical to
 * `arcPoints(center, rx, …)` (F2-AC3 parity).
 */
export function ellipseArcPoints(
  center: Point,
  rx: number,
  ry: number,
  startAngle: number,
  endAngle: number,
  segments: number,
): Point[] {
  if (segments < 1) {throw new Error(`arc needs at least 1 segment, got ${segments}`);}
  return Array.from({length: segments + 1}, (_, i) => {
    const t = i / segments;
    const angle = startAngle + (endAngle - startAngle) * t;
    return {
      x: center.x + rx * Math.cos(angle),
      y: center.y + ry * Math.sin(angle),
    };
  });
}

function makePolygon(points: Point[], style: PenStyle): PolygonGeometry {
  if (points.length < 3) {throw new Error(`makePolygon requires at least 3 points, got ${points.length}`);}
  const closed = [...points, points[0]];
  return {...style, type: 'GEO_polygon', points: closed};
}

function makeCircle(center: Point, radius: number, style: PenStyle): CircleGeometry {
  return {
    ...style,
    type: 'GEO_circle',
    ellipseCenterPoint: center,
    ellipseMajorAxisRadius: radius,
    ellipseMinorAxisRadius: radius,
    ellipseAngle: 0,
  };
}

function makeEllipse(center: Point, radiusX: number, radiusY: number, style: PenStyle): EllipseGeometry {
  return {
    ...style,
    type: 'GEO_ellipse',
    ellipseCenterPoint: center,
    ellipseMajorAxisRadius: radiusX,
    ellipseMinorAxisRadius: radiusY,
    ellipseAngle: 0,
  };
}

const REGULAR_POLYGONS = [
  ['triangle', 'Triangle', 3],
  ['diamond', 'Diamond', 4],
  ['pentagon', 'Pentagon', 5],
  ['hexagon', 'Hexagon', 6],
  ['heptagon', 'Heptagon', 7],
  ['octagon', 'Octagon', 8],
] as const;

/**
 * Shared vertex builder for the right-pointing block-arrow family
 * (blockArrow, thickArrow, chevronTailArrow). Returns the 7 outline vertices
 * clockwise from tail-top-left; chevronTailArrow appends one extra vertex for
 * its V-notch. Centralising the formula here means blockArrow and thickArrow
 * differ only in their parameter defaults, with no duplicated geometry logic.
 */
function buildBlockArrowPoints(center: Point, params: Record<string, number>): Point[] {
  const hl = params.length / 2;
  const sh = params.shaftWidth / 2;
  const hh = params.headWidth / 2;
  const shaftEnd = center.x + hl - params.headLength;
  return [
    {x: center.x - hl, y: center.y - sh},
    {x: shaftEnd,       y: center.y - sh},
    {x: shaftEnd,       y: center.y - hh},
    {x: center.x + hl,  y: center.y},
    {x: shaftEnd,       y: center.y + hh},
    {x: shaftEnd,       y: center.y + sh},
    {x: center.x - hl,  y: center.y + sh},
  ];
}

// ---------------------------------------------------------------------------
// Pseudo-3D solids — oblique (cabinet) projection helpers (v1.1.0)
// ---------------------------------------------------------------------------
// Each 3D solid (cuboid, cube, square pyramid, cylinder, cone) is a single
// closed GEO_polygon traced as one continuous pen stroke (an Eulerian-style
// wireframe walk that retraces the minimum number of edges). This keeps the
// firmware's single-element lasso, pen colour, width and rotation all working
// — the capabilities the v1.0.4 image-fallback 3D shapes lost.
//
// Oblique (cabinet) projection: the front face is drawn axis-aligned, and
// depth is a parallel offset vector D at angle θ (default 30°), foreshortened
// by DEPTH_SCALE so the solids read clearly at the 48-px palette size.

/**
 * Cabinet-projection foreshortening factor for the depth axis. 0.7 is the
 * conventional cabinet value — enough depth to read as 3D without the back
 * face crowding the front at thumbnail scale.
 */
const DEPTH_SCALE = 0.7;

/**
 * Depth vector D for oblique projection: a back-face vertex equals its
 * front-face vertex plus D. In screen coords (−y is up) a positive angle
 * sends depth up-and-to-the-right, so `dx > 0` and `dy < 0` for the default
 * 30°. Magnitude is `depth · DEPTH_SCALE` (independent of angle).
 */
export function obliqueDepth(depth: number, angleDeg: number): {dx: number; dy: number} {
  const rad = (angleDeg * Math.PI) / 180;
  const d = depth * DEPTH_SCALE;
  return {dx: d * Math.cos(rad), dy: -d * Math.sin(rad)};
}

/**
 * Translate a vertex list so its bounding box is centered on `center`. Used
 * by the 3D builders so an oblique solid is *visually* centered (INV6) even
 * though its raw vertex centroid is offset by ~D/2 — the firmware lasso and
 * the page-centered insert both key off the visible bounds, not the centroid.
 */
function centerOnBbox(points: Point[], center: Point): Point[] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) {minX = p.x;}
    if (p.x > maxX) {maxX = p.x;}
    if (p.y < minY) {minY = p.y;}
    if (p.y > maxY) {maxY = p.y;}
  }
  const ox = center.x - (minX + maxX) / 2;
  const oy = center.y - (minY + maxY) / 2;
  return points.map(p => ({x: p.x + ox, y: p.y + oy}));
}

/**
 * Ordered single-path vertex list for the visible box wireframe (front +
 * top + right faces), shared by cuboid and cube. The front face is offset by
 * −D/2 and the back by +D/2 so the solid's bounding box straddles `center`
 * (INV6 / F3-FR5), even though the raw vertex centroid is not at `center`.
 *
 * The visible wireframe has 9 edges over 7 drawn corners with four odd-degree
 * corners, so a single closed stroke must retrace exactly 3 edges. The walk
 * below is a verified Eulerian circuit; it ends at TR so `makePolygon`'s
 * closing seam is the real edge TR→TL (never a face diagonal):
 *
 *   [TL, TR, BR, BR', TR', TL', TL, BL, BR, BR', TR', TR]
 *   retraced: TL-TR (close), BR-BR', BR'-TR'  (invisible on e-ink)
 *
 * BL' (back-bottom-left) is hidden and never drawn.
 */
export function buildBoxPoints(
  center: Point,
  w: number,
  h: number,
  depth: number,
  angleDeg: number,
): Point[] {
  const hw = w / 2;
  const hh = h / 2;
  const {dx, dy} = obliqueDepth(depth, angleDeg);
  // Build the front face about a provisional origin; the back face is the
  // front face + D. centerOnBbox then makes the whole solid bbox-centered on
  // `center` (INV6 / F3-FR5) — exact regardless of depth/angle skew.
  const TL: Point = {x: -hw, y: -hh};
  const TR: Point = {x: hw, y: -hh};
  const BR: Point = {x: hw, y: hh};
  const BL: Point = {x: -hw, y: hh};
  const TLb: Point = {x: TL.x + dx, y: TL.y + dy};
  const TRb: Point = {x: TR.x + dx, y: TR.y + dy};
  const BRb: Point = {x: BR.x + dx, y: BR.y + dy};
  const walk = [TL, TR, BR, BRb, TRb, TLb, TL, BL, BR, BRb, TRb, TR];
  return centerOnBbox(walk, center);
}

/**
 * Ordered single-path vertex list for the square-pyramid wireframe (base
 * rhombus + three visible slant edges), used by squarePyramid. The base is
 * offset so the solid's bounding box is centered on `center` (INV6), and the
 * apex sits above the base centroid offset by D/2.
 *
 * The visible wireframe has 7 edges (4 base + 3 slant); the back-right slant
 * BR'→A is hidden. Four odd-degree vertices mean a single closed stroke
 * retraces exactly 2 edges — the back-left slant as an out-and-back spur and
 * the front base edge as the closing seam. Verified Eulerian circuit:
 *
 *   [BL, BR, BR', BL', A, BL', BL, A, BR]
 *   retraced: BL'-A (spur) and BL-BR (close)
 */
export function buildPyramidPoints(
  center: Point,
  baseWidth: number,
  height: number,
  depth: number,
  angleDeg: number,
): Point[] {
  const hw = baseWidth / 2;
  const {dx, dy} = obliqueDepth(depth, angleDeg);
  // Build the wireframe at a provisional origin, then translate so its
  // bounding box is centered on `center` (INV6). The oblique depth offset
  // skews the bbox in both axes and the apex extends it upward, so a closed-
  // form centre offset is fiddle-prone — centring the finished bbox is exact
  // and self-documenting.
  const BL: Point = {x: -hw, y: 0};
  const BR: Point = {x: hw, y: 0};
  const BLb: Point = {x: BL.x + dx, y: BL.y + dy};
  const BRb: Point = {x: BR.x + dx, y: BR.y + dy};
  // Apex above the base centroid, lifted by the full apex height.
  const cx = (BL.x + BR.x + BLb.x + BRb.x) / 4;
  const cy = (BL.y + BR.y + BLb.y + BRb.y) / 4;
  const A: Point = {x: cx, y: cy - height};
  const walk = [BL, BR, BRb, BLb, A, BLb, BL, A, BR];
  return centerOnBbox(walk, center);
}

export const SHAPES: readonly Shape[] = [
  {
    id: 'rectangle',
    label: 'Rectangle',
    category: 'basic',
    geometryType: 'GEO_polygon',
    parameters: [
      { id: 'width',
        label: 'Width (px)',
        defaultValue: 200,
        min: 1,
        unit: 'px',
      },
      { id: 'height',
        label: 'Height (px)',
        defaultValue: 200,
        min: 1,
        unit: 'px',
      },
    ],
    build: (center, params, style) => {
      const hw = params.width / 2;
      const hh = params.height / 2;
      return makePolygon(
        [
          {x: center.x - hw, y: center.y - hh},
          {x: center.x + hw, y: center.y - hh},
          {x: center.x + hw, y: center.y + hh},
          {x: center.x - hw, y: center.y + hh},
        ],
        style,
      );
    },
  },

  {
    id: 'circle',
    label: 'Circle',
    category: 'basic',
    geometryType: 'GEO_circle',
    parameters: [
      { id: 'radius',
        label: 'Radius (px)',
        defaultValue: 100,
        min: 1,
        unit: 'px',
      },
    ],
    build: (center, params, style) => makeCircle(
      center,
      params.radius,
      style
    ),
  },

  {
    id: 'roundedRect',
    label: 'Rounded Rectangle',
    category: 'basic',
    geometryType: 'GEO_polygon',
    parameters: [
      {
        id: 'width',
        label: 'Width (px)',
        defaultValue: 200,
        min: 1,
        unit: 'px',
      },
      {
        id: 'height',
        label: 'Height (px)',
        defaultValue: 200,
        min: 1,
        unit: 'px',
      },
      {
        id: 'cornerRadius',
        label: 'Corner Radius (px)',
        defaultValue: 25,
        min: 1,
        unit: 'px',
      },
    ],
    build: (center, params, style) =>
      makePolygon(
        roundedRectPoints(
          center,
          params.width / 2,
          params.height / 2,
          params.cornerRadius
        ),
        style
      ),
  },

  {
    id: 'ellipse',
    label: 'Ellipse',
    category: 'basic',
    geometryType: 'GEO_ellipse',
    parameters: [
      {
        id: 'radiusX',
        label: 'Radius X (px)',
        defaultValue: 150,
        min: 1,
        unit: 'px',
      },
      {
        id: 'radiusY',
        label: 'Radius Y (px)',
        defaultValue: 100,
        min: 1,
        unit: 'px',
      },
    ],
    build: (center, params, style) => makeEllipse(center, params.radiusX, params.radiusY, style),
  },

  {
    id: 'line',
    label: 'Line',
    category: 'basic',
    geometryType: 'straightLine',
    parameters: [
      {
        id: 'length',
        label: 'Length (px)',
        defaultValue: 200,
        min: 1,
        unit: 'px',
      },
      {
        id: 'angle',
        label: 'Angle (degrees)',
        defaultValue: 0,
        unit: 'deg',
      },
    ],
    build: (center, params, style) => {
      const rad = (params.angle * Math.PI) / 180;
      const hl = params.length / 2;
      const dx = Math.cos(rad) * hl;
      const dy = Math.sin(rad) * hl;
      return makeLine(
        { x: center.x - dx, y: center.y - dy },
        { x: center.x + dx, y: center.y + dy },
        style,
      );
    },
  },

  {
    id: 'parallelogram',
    label: 'Parallelogram',
    category: 'basic',
    geometryType: 'GEO_polygon',
    parameters: [
      {
        id: 'width',
        label: 'Width (px)',
        defaultValue: 200,
        min: 1,
        unit: 'px',
      },
      {
        id: 'height',
        label: 'Height (px)',
        defaultValue: 150,
        min: 1,
        unit: 'px',
      },
      {
        id: 'offset',
        label: 'Offset',
        defaultValue: 50,
        unit: 'px',
        // Can be negative for left-lean
      },
    ],
    build: (center, params, style) => {
      const hw = params.width / 2;
      const hh = params.height / 2;
      const off = params.offset;
      return makePolygon(
        [
          { x: center.x - hw + off, y: center.y - hh },
          { x: center.x + hw + off, y: center.y - hh },
          { x: center.x + hw - off, y: center.y + hh },
          { x: center.x - hw - off, y: center.y + hh },
        ],
        style
      );
    },
  },

  ...REGULAR_POLYGONS.map(([id, label, sides]): Shape => ({
    id,
    label,
    category: 'basic',
    geometryType: 'GEO_polygon',
    parameters: [
      {
        id: 'radius',
        label: 'Radius (px)',
        defaultValue: 100,
        min: 1,
        unit: 'px',
      },
      {
        id: 'rotation',
        label: 'Rotation (deg)',
        defaultValue: 0,
        unit: 'deg',
      },
    ],
    build: (center, params, style) => makePolygon(
      regularPolygon(
        center,
        params.radius,
        sides,
          -Math.PI / 2 + (params.rotation * Math.PI) / 180,
      ),
      style
    ),
  })),

  // ---------------------------------------------------------------------------
  // v1.1.0 — 3D Shapes (pseudo-3D solids, oblique projection)
  // ---------------------------------------------------------------------------
  // Each solid is a single closed GEO_polygon traced as one continuous pen
  // stroke (see the oblique-projection helper block above). This restores the
  // 3D shapes dropped in v1.0.4 the right way: as real geometries the firmware
  // can lasso as one element and re-style with pen colour / width / rotation,
  // rather than the baked-bitmap fallback that lost all of that.
  {
    id: 'cuboid',
    label: 'Cuboid',
    category: 'threeD',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'width', label: 'Width (px)', defaultValue: 200, min: 1, unit: 'px'},
      {id: 'height', label: 'Height (px)', defaultValue: 150, min: 1, unit: 'px'},
      {id: 'depth', label: 'Depth (px)', defaultValue: 80, min: 1, unit: 'px'},
      {id: 'angle', label: 'Angle (deg)', defaultValue: 30, min: 0, max: 60, unit: 'deg'},
    ],
    build: (center, params, style) =>
      makePolygon(
        buildBoxPoints(center, params.width, params.height, params.depth, params.angle),
        style,
      ),
  },

  {
    id: 'cube',
    label: 'Cube',
    category: 'threeD',
    geometryType: 'GEO_polygon',
    parameters: [
      // A cube is the box builder with width = height = depth, exposed as a
      // single `size` preset so the user doesn't have to keep three sliders
      // in lockstep (same builder-sharing pattern as blockArrow/thickArrow).
      {id: 'size', label: 'Size (px)', defaultValue: 180, min: 1, unit: 'px'},
      {id: 'angle', label: 'Angle (deg)', defaultValue: 30, min: 0, max: 60, unit: 'deg'},
    ],
    build: (center, params, style) =>
      makePolygon(
        buildBoxPoints(center, params.size, params.size, params.size, params.angle),
        style,
      ),
  },

  {
    id: 'squarePyramid',
    label: 'Square Pyramid',
    category: 'threeD',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'baseWidth', label: 'Base (px)', defaultValue: 180, min: 1, unit: 'px'},
      {id: 'height', label: 'Height (px)', defaultValue: 160, min: 1, unit: 'px'},
      {id: 'depth', label: 'Depth (px)', defaultValue: 80, min: 1, unit: 'px'},
      {id: 'angle', label: 'Angle (deg)', defaultValue: 30, min: 0, max: 60, unit: 'deg'},
    ],
    build: (center, params, style) =>
      makePolygon(
        buildPyramidPoints(center, params.baseWidth, params.height, params.depth, params.angle),
        style,
      ),
  },

  {
    id: 'cylinder',
    label: 'Cylinder',
    category: 'threeD',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'radiusX', label: 'Radius (px)', defaultValue: 90, min: 1, unit: 'px'},
      {id: 'height', label: 'Height (px)', defaultValue: 200, min: 1, unit: 'px'},
      {id: 'capRatio', label: 'Cap (%)', defaultValue: 28, min: 10, max: 60, unit: '%'},
    ],
    build: (center, params, style) => {
      // Full top ellipse rim + front half of the bottom ellipse + two
      // vertical seams, traced as one loop. The cap is foreshortened
      // (ry < rx) so the rims read as ellipses, not circles. No edge is
      // retraced (F5-AC1); makePolygon's closing seam is the single top
      // chord, which is one new edge (not a duplicate).
      const rx = params.radiusX;
      const ry = (rx * params.capRatio) / 100;
      const topC: Point = {x: center.x, y: center.y - params.height / 2};
      const botC: Point = {x: center.x, y: center.y + params.height / 2};
      // 32 segments on the full top rim keeps it smooth at icon + page
      // scale (the front bottom half-rim needs roughly half that), mirroring
      // how the arrow arcs size their sampling.
      const TOP_SEGMENTS = 32;
      const BOT_SEGMENTS = 16;
      const FULL_TURN = 2 * Math.PI;
      const leftBottom: Point = {x: botC.x - rx, y: botC.y};
      const rightTop: Point = {x: topC.x + rx, y: topC.y};
      // Top rim: full ellipse starting and ending at the left point (π → π + a
      // full turn).
      const topRim = ellipseArcPoints(topC, rx, ry, Math.PI, Math.PI + FULL_TURN, TOP_SEGMENTS);
      // Bottom rim: front half only (left π → right 0, through +y front).
      const botFront = ellipseArcPoints(botC, rx, ry, Math.PI, 0, BOT_SEGMENTS);
      return makePolygon([...topRim, leftBottom, ...botFront, rightTop], style);
    },
  },

  {
    id: 'cone',
    label: 'Cone',
    category: 'threeD',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'radiusX', label: 'Radius (px)', defaultValue: 90, min: 1, unit: 'px'},
      {id: 'height', label: 'Height (px)', defaultValue: 200, min: 1, unit: 'px'},
      {id: 'capRatio', label: 'Cap (%)', defaultValue: 28, min: 10, max: 60, unit: '%'},
    ],
    build: (center, params, style) => {
      // Apex + front half of the elliptical base + two straight slant
      // seams, as one closed polygon with no retracing (F6-AC4). The base
      // front arc dips ry below baseCenter, so the apex/base stack is
      // offset to absorb that overhang while keeping the apex→base axial
      // height equal to `height` and the bbox centered on `center` (F6-FR4):
      //   apex      = center − (0, (height + ry)/2)
      //   baseCenter = center + (0, (height − ry)/2)
      const rx = params.radiusX;
      const ry = (rx * params.capRatio) / 100;
      const apex: Point = {x: center.x, y: center.y - (params.height + ry) / 2};
      const baseC: Point = {x: center.x, y: center.y + (params.height - ry) / 2};
      const BASE_SEGMENTS = 16;
      // Front half of the base: left (π) → right (0) through +y (front).
      // The arc endpoints are the left/right base extremes the slant seams
      // attach to, so no separate seam vertices are needed. The closing
      // apex→apex seam is zero-length and harmless (EC5).
      const baseFront = ellipseArcPoints(baseC, rx, ry, Math.PI, 0, BASE_SEGMENTS);
      return makePolygon([apex, ...baseFront, apex], style);
    },
  },

  // ---------------------------------------------------------------------------
  // v1.0.4 — Arrows
  // ---------------------------------------------------------------------------
  // 3D wireframes (cube / cylinder / cone / pyramid / sphere / hemisphere
  // / triangularPrism) and curvedArrow / axes were removed in v1.0.4:
  // they required multi-geometry composites that can't be lasso'd or
  // re-styled as a single object. See ShapeBuildResult doc-block above.
  // Every arrow is one closed polygon so users can lasso + re-style it
  // as a single object after insert. "Block", "thick" and "double" are
  // parameter variants of the same hexagonal outline; keeping separate
  // ShapeIds means the user doesn't have to fiddle with sliders to get
  // a common preset.
  {
    id: 'blockArrow',
    label: 'Block Arrow',
    category: 'arrows',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'length', label: 'Length (px)', defaultValue: 260, min: 1, unit: 'px'},
      {id: 'shaftWidth', label: 'Shaft (px)', defaultValue: 80, min: 1, unit: 'px'},
      {id: 'headWidth', label: 'Head Width (px)', defaultValue: 160, min: 1, unit: 'px'},
      {id: 'headLength', label: 'Head Length (px)', defaultValue: 90, min: 1, unit: 'px'},
    ],
    build: (center, params, style) =>
      makePolygon(buildBlockArrowPoints(center, params), style),
  },

  {
    id: 'doubleArrow',
    label: 'Double Arrow',
    category: 'arrows',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'length', label: 'Length (px)', defaultValue: 300, min: 1, unit: 'px'},
      {id: 'shaftWidth', label: 'Shaft (px)', defaultValue: 70, min: 1, unit: 'px'},
      {id: 'headWidth', label: 'Head Width (px)', defaultValue: 150, min: 1, unit: 'px'},
      {id: 'headLength', label: 'Head Length (px)', defaultValue: 70, min: 1, unit: 'px'},
    ],
    build: (center, params, style) => {
      const hl = params.length / 2;
      const sh = params.shaftWidth / 2;
      const hh = params.headWidth / 2;
      const leftHead = center.x - hl + params.headLength;
      const rightHead = center.x + hl - params.headLength;
      return makePolygon(
        [
          {x: leftHead, y: center.y - hh},
          {x: center.x - hl, y: center.y},
          {x: leftHead, y: center.y + hh},
          {x: leftHead, y: center.y + sh},
          {x: rightHead, y: center.y + sh},
          {x: rightHead, y: center.y + hh},
          {x: center.x + hl, y: center.y},
          {x: rightHead, y: center.y - hh},
          {x: rightHead, y: center.y - sh},
          {x: leftHead, y: center.y - sh},
        ],
        style,
      );
    },
  },

  {
    id: 'thickArrow',
    label: 'Thick Arrow',
    category: 'arrows',
    geometryType: 'GEO_polygon',
    parameters: [
      // Same signature as blockArrow but with a fatter shaft and a
      // smaller head so the arrow reads as "chunky". Sharing the
      // parameter schema keeps the palette's stroke-preview logic
      // simple (no per-arrow special-casing).
      {id: 'length', label: 'Length (px)', defaultValue: 240, min: 1, unit: 'px'},
      {id: 'shaftWidth', label: 'Shaft (px)', defaultValue: 140, min: 1, unit: 'px'},
      {id: 'headWidth', label: 'Head Width (px)', defaultValue: 200, min: 1, unit: 'px'},
      {id: 'headLength', label: 'Head Length (px)', defaultValue: 80, min: 1, unit: 'px'},
    ],
    build: (center, params, style) =>
      makePolygon(buildBlockArrowPoints(center, params), style),
  },

  {
    id: 'ballArrow',
    label: 'Ball Arrow',
    category: 'arrows',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'length', label: 'Length (px)', defaultValue: 280, min: 1, unit: 'px'},
      {id: 'ballRadius', label: 'Ball (px)', defaultValue: 45, min: 1, unit: 'px'},
      {id: 'shaftWidth', label: 'Shaft (px)', defaultValue: 40, min: 1, unit: 'px'},
      {id: 'headWidth', label: 'Head Width (px)', defaultValue: 130, min: 1, unit: 'px'},
      {id: 'headLength', label: 'Head Length (px)', defaultValue: 80, min: 1, unit: 'px'},
    ],
    build: (center, params, style) => {
      // Arrow with a filled-looking disc at the tail. The whole outline
      // is one closed polygon so pen colour / width and lasso apply to
      // the entire shape. Geometry is:
      //   ball ← long arc (≈270°+) → shaft-top → head-top-wing →
      //   tip → head-bottom-wing → shaft-bottom → ball-back-to-start
      // The arc deliberately clamps sh ≤ r so the shaft can never be
      // wider than the ball's diameter (would produce a degenerate
      // intersection).
      const hl = params.length / 2;
      const r = params.ballRadius;
      const sh = Math.min(params.shaftWidth / 2, r * 0.95);
      const hh = params.headWidth / 2;
      const ball = {x: center.x - hl + r, y: center.y};
      const alpha = Math.asin(sh / r);
      // Top shaft-to-ball connection is at angle -alpha; bottom is at
      // +alpha. Sweep the long way round (through -π) so the arc draws
      // the ~270° visible portion of the ball.
      const ballArc = arcPoints(ball, r, -alpha, alpha - 2 * Math.PI, 32);
      const tipX = center.x + hl;
      const shaftEnd = tipX - params.headLength;
      return makePolygon(
        [
          ...ballArc,
          {x: shaftEnd, y: center.y + sh},
          {x: shaftEnd, y: center.y + hh},
          {x: tipX, y: center.y},
          {x: shaftEnd, y: center.y - hh},
          {x: shaftEnd, y: center.y - sh},
        ],
        style,
      );
    },
  },

  {
    id: 'chevronTailArrow',
    label: 'Chevron Tail Arrow',
    category: 'arrows',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'length', label: 'Length (px)', defaultValue: 280, min: 1, unit: 'px'},
      {id: 'shaftWidth', label: 'Shaft (px)', defaultValue: 80, min: 1, unit: 'px'},
      {id: 'headWidth', label: 'Head Width (px)', defaultValue: 160, min: 1, unit: 'px'},
      {id: 'headLength', label: 'Head Length (px)', defaultValue: 90, min: 1, unit: 'px'},
      {id: 'tailNotch', label: 'Tail Notch (px)', defaultValue: 45, min: 0, unit: 'px'},
    ],
    build: (center, params, style) => {
      // Block arrow whose flat tail has been replaced with a V-notch
      // cut INTO the body so the tail silhouette reads as a ">". This
      // makes the tail visually echo the head, clearly communicating
      // direction without the double-headed-arrow implication of
      // doubleArrow.
      const hl = params.length / 2;
      const notch = Math.min(params.tailNotch, params.length * 0.45);
      return makePolygon(
        [
          ...buildBlockArrowPoints(center, params),
          // Tail chevron: indent inward to the middle, then back out.
          {x: center.x - hl + notch, y: center.y},
        ],
        style,
      );
    },
  },

  {
    id: 'refreshArrow',
    label: 'Refresh Arrow',
    category: 'arrows',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'radius', label: 'Radius (px)', defaultValue: 110, min: 1, unit: 'px'},
      {id: 'band', label: 'Band (px)', defaultValue: 42, min: 1, unit: 'px'},
      {id: 'head', label: 'Head (px)', defaultValue: 55, min: 1, unit: 'px'},
    ],
    build: (center, params, style) => {
      // Circular refresh glyph: an annular band with a gap and one
      // arrowhead at the gap's trailing end. Authored as a single
      // closed polygon — outer arc, arrowhead, inner arc back — so
      // pen style and lasso cover the whole ring including the head.
      const R = params.radius;
      const band = Math.min(params.band, R - 1);
      const r = R - band;
      const head = params.head;
      // Small gap above the top of the circle; arrow head lands to the
      // upper-left, pointing up-right, giving the classic clockwise
      // "reload" silhouette users already know from browser toolbars.
      const gap = 0.35;
      const startAngle = -Math.PI / 2 + gap;
      const endAngle = startAngle + 2 * Math.PI - 2 * gap;
      const outerArc = arcPoints(center, R, startAngle, endAngle, 40);
      const innerArc = arcPoints(center, r, endAngle, startAngle, 40);
      const midR = (R + r) / 2;
      const cosE = Math.cos(endAngle);
      const sinE = Math.sin(endAngle);
      // Tangent in the direction of increasing θ — the arrow's travel
      // direction at the end of the arc.
      const tangent = {x: -sinE, y: cosE};
      const mid = {x: center.x + midR * cosE, y: center.y + midR * sinE};
      const outerWing = {
        x: center.x + (R + head / 2) * cosE,
        y: center.y + (R + head / 2) * sinE,
      };
      const innerWing = {
        x: center.x + Math.max(1, r - head / 2) * cosE,
        y: center.y + Math.max(1, r - head / 2) * sinE,
      };
      const tip = {
        x: mid.x + tangent.x * head,
        y: mid.y + tangent.y * head,
      };
      return makePolygon(
        [...outerArc, outerWing, tip, innerWing, ...innerArc],
        style,
      );
    },
  },

  // ---------------------------------------------------------------------------
  // v1.0.4 — Flowchart
  // ---------------------------------------------------------------------------
  {
    id: 'flowchartPreparation',
    label: 'Preparation',
    category: 'flowchart',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'width', label: 'Width (px)', defaultValue: 240, min: 1, unit: 'px'},
      {id: 'height', label: 'Height (px)', defaultValue: 140, min: 1, unit: 'px'},
      {id: 'tip', label: 'Tip (px)', defaultValue: 40, min: 0, unit: 'px'},
    ],
    build: (center, params, style) => {
      const hw = params.width / 2;
      const hh = params.height / 2;
      const t = params.tip;
      return makePolygon(
        [
          {x: center.x - hw, y: center.y},
          {x: center.x - hw + t, y: center.y - hh},
          {x: center.x + hw - t, y: center.y - hh},
          {x: center.x + hw, y: center.y},
          {x: center.x + hw - t, y: center.y + hh},
          {x: center.x - hw + t, y: center.y + hh},
        ],
        style,
      );
    },
  },

  {
    id: 'flowchartDocument',
    label: 'Document',
    category: 'flowchart',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'width', label: 'Width (px)', defaultValue: 240, min: 1, unit: 'px'},
      {id: 'height', label: 'Height (px)', defaultValue: 180, min: 1, unit: 'px'},
      {id: 'waveDepth', label: 'Wave (px)', defaultValue: 30, min: 0, unit: 'px'},
    ],
    build: (center, params, style) => {
      const hw = params.width / 2;
      const hh = params.height / 2;
      const d = params.waveDepth;
      // Bottom edge traces one up-down-up wave; the top and sides are
      // straight. Two side points on each bottom dip keep the wave
      // readable even at icon scale.
      return makePolygon(
        [
          {x: center.x - hw, y: center.y - hh},
          {x: center.x + hw, y: center.y - hh},
          {x: center.x + hw, y: center.y + hh - d},
          {x: center.x + hw * 0.5, y: center.y + hh},
          {x: center.x, y: center.y + hh - d},
          {x: center.x - hw * 0.5, y: center.y + hh},
          {x: center.x - hw, y: center.y + hh - d},
        ],
        style,
      );
    },
  },

  {
    id: 'flowchartTerminator',
    label: 'Terminator',
    category: 'flowchart',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'width', label: 'Width (px)', defaultValue: 240, min: 1, unit: 'px'},
      {id: 'height', label: 'Height (px)', defaultValue: 120, min: 1, unit: 'px'},
    ],
    build: (center, params, style) => {
      const hw = params.width / 2;
      const hh = params.height / 2;
      // A stadium is a rounded-rect where the corner radius equals the
      // short half-dimension. Reusing roundedRectPoints keeps the
      // smooth-corner sampling consistent with the rounded-rect shape.
      return makePolygon(
        roundedRectPoints(center, hw, hh, Math.min(hw, hh)),
        style,
      );
    },
  },

  {
    id: 'flowchartManualInput',
    label: 'Manual Input',
    category: 'flowchart',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'width', label: 'Width (px)', defaultValue: 240, min: 1, unit: 'px'},
      {id: 'height', label: 'Height (px)', defaultValue: 160, min: 1, unit: 'px'},
      {id: 'slope', label: 'Slope (px)', defaultValue: 50, min: 0, unit: 'px'},
    ],
    build: (center, params, style) => {
      const hw = params.width / 2;
      const hh = params.height / 2;
      const s = params.slope;
      return makePolygon(
        [
          {x: center.x - hw, y: center.y - hh + s},
          {x: center.x + hw, y: center.y - hh},
          {x: center.x + hw, y: center.y + hh},
          {x: center.x - hw, y: center.y + hh},
        ],
        style,
      );
    },
  },

  // ---------------------------------------------------------------------------
  // v1.0.4 — Decorative
  // ---------------------------------------------------------------------------
  // Single closed polygons. These replace the dropped 3D / curved-arrow
  // composites: users still get "rich" shapes to garnish a page, but
  // each one lasso's and restyles as one ink element.
  {
    id: 'certificate',
    label: 'Certificate',
    category: 'decorative',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'width', label: 'Width (px)', defaultValue: 300, min: 1, unit: 'px'},
      {id: 'height', label: 'Height (px)', defaultValue: 200, min: 1, unit: 'px'},
    ],
    build: (center, params, style) => {
      const hw = params.width / 2;
      const hh = params.height / 2;
      // Five outward-bulging semicircle scallops across the top edge
      // give the rectangle an award-border silhouette that reads as
      // "certificate" even at icon scale. Count is fixed because the
      // palette exposes only px / deg / % parameter units; exposing
      // scallop count would need a new unit.
      const SCALLOPS = 5;
      const segW = params.width / SCALLOPS;
      const scallopR = segW / 2;
      const topY = center.y - hh;
      const points: Point[] = [];
      for (let i = 0; i < SCALLOPS; i++) {
        const cx = center.x - hw + segW * i + segW / 2;
        // Arc π→2π bulges into -y (outward from the top edge). Skip
        // the first sample on all but the first scallop — each
        // scallop's start is the previous scallop's end.
        const arc = arcPoints({x: cx, y: topY}, scallopR, Math.PI, 2 * Math.PI, 10);
        points.push(...(i === 0 ? arc : arc.slice(1)));
      }
      points.push({x: center.x + hw, y: center.y + hh});
      points.push({x: center.x - hw, y: center.y + hh});
      return makePolygon(points, style);
    },
  },

  {
    id: 'ribbon',
    label: 'Ribbon',
    category: 'decorative',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'width', label: 'Width (px)', defaultValue: 320, min: 1, unit: 'px'},
      {id: 'height', label: 'Height (px)', defaultValue: 90, min: 1, unit: 'px'},
      {id: 'notch', label: 'Notch (px)', defaultValue: 35, min: 0, unit: 'px'},
    ],
    build: (center, params, style) => {
      const hw = params.width / 2;
      const hh = params.height / 2;
      // Clamp notch so the two inward points can't cross the midline
      // (would flip the polygon inside-out).
      const n = Math.min(params.notch, hw - 1);
      // Horizontal hexagon with swallowtail V-notches cut INWARD on
      // each end — classic "award ribbon" silhouette.
      return makePolygon(
        [
          {x: center.x - hw, y: center.y - hh},
          {x: center.x + hw, y: center.y - hh},
          {x: center.x + hw - n, y: center.y},
          {x: center.x + hw, y: center.y + hh},
          {x: center.x - hw, y: center.y + hh},
          {x: center.x - hw + n, y: center.y},
        ],
        style,
      );
    },
  },

  {
    id: 'banner',
    label: 'Banner',
    category: 'decorative',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'width', label: 'Width (px)', defaultValue: 280, min: 1, unit: 'px'},
      {id: 'height', label: 'Height (px)', defaultValue: 100, min: 1, unit: 'px'},
      {id: 'tail', label: 'Tail (px)', defaultValue: 40, min: 0, unit: 'px'},
    ],
    build: (center, params, style) => {
      const hw = params.width / 2;
      const hh = params.height / 2;
      const t = params.tail;
      // Horizontal hexagon with OUTWARD points on each end — mirror
      // of the ribbon. Reads as a medieval pennant / title banner.
      return makePolygon(
        [
          {x: center.x - hw, y: center.y - hh},
          {x: center.x + hw, y: center.y - hh},
          {x: center.x + hw + t, y: center.y},
          {x: center.x + hw, y: center.y + hh},
          {x: center.x - hw, y: center.y + hh},
          {x: center.x - hw - t, y: center.y},
        ],
        style,
      );
    },
  },

  {
    id: 'starburst',
    label: 'Starburst',
    category: 'decorative',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'width', label: 'Width (px)', defaultValue: 320, min: 1, unit: 'px'},
      {id: 'height', label: 'Height (px)', defaultValue: 220, min: 1, unit: 'px'},
      {id: 'innerRatio', label: 'Spike depth (%)', defaultValue: 72, min: 30, max: 95, unit: '%'},
    ],
    build: (center, params, style) => {
      // Closed polygon whose 2·POINTS vertices alternate between an
      // outer and inner ellipse — the classic retail "SALE" starburst.
      // The outer contour is a true ellipse (so width ≠ height gives
      // the oval-seal variant), and each valley sits on a scaled copy
      // of that ellipse so the spike depth is consistent along both
      // axes even when the overall shape is stretched.
      //
      // POINTS is an internal constant rather than a parameter because
      // the palette's parameter units are only px / deg / %, none of
      // which round-trip cleanly for an integer spike count. Sixteen
      // spikes reads as a sale sticker at thumbnail size — fewer feels
      // sparse, more reads as a gear tooth.
      const POINTS = 16;
      const outerRx = params.width / 2;
      const outerRy = params.height / 2;
      const innerFactor = params.innerRatio / 100;
      const innerRx = outerRx * innerFactor;
      const innerRy = outerRy * innerFactor;
      // Start at -π/2 so the first outer vertex points up — the most
      // visually settled orientation, matching "SALE" logos that lead
      // with a top spike.
      const startAngle = -Math.PI / 2;
      const step = Math.PI / POINTS; // half a spike-to-spike arc
      const pts: Point[] = Array.from({length: POINTS * 2}, (_, i) => {
        const angle = startAngle + step * i;
        const outer = i % 2 === 0;
        const rx = outer ? outerRx : innerRx;
        const ry = outer ? outerRy : innerRy;
        return {
          x: center.x + rx * Math.cos(angle),
          y: center.y + ry * Math.sin(angle),
        };
      });
      return makePolygon(pts, style);
    },
  },

  {
    id: 'awardBadge',
    label: 'Award Badge',
    category: 'decorative',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'radius', label: 'Medallion (px)', defaultValue: 90, min: 10, unit: 'px'},
      {id: 'tailLength', label: 'Tail (px)', defaultValue: 140, min: 0, unit: 'px'},
      {id: 'tailSpanDeg', label: 'Tail span (deg)', defaultValue: 30, min: 5, max: 60, unit: 'deg'},
      {id: 'tailSpreadDeg', label: 'Splay (deg)', defaultValue: 20, min: 0, max: 45, unit: 'deg'},
      {id: 'notchDepth', label: 'V-notch (px)', defaultValue: 30, min: 0, unit: 'px'},
    ],
    build: (center, params, style) => {
      // A single non-self-intersecting closed polygon that reads as
      // "medallion + twin ribbon tails". The tails diverge outward
      // rather than cross: a self-intersecting X below the medallion
      // looks closer to a real award rosette but breaks the
      // single-simple-polygon invariant every other v1.0.4 shape holds
      // to, which keeps the firmware lasso / pen-style path predictable.
      //
      // Boundary order (clockwise visually, Y-down screen coords —
      // θ increasing = CW visually here):
      //   1. Long top arc: top of circle → past right → right-tail
      //      outer attachment (≈ 5/6 of the circle).
      //   2. Right tail: outer-bottom corner → V-notch → inner-bottom.
      //   3. Short bottom arc: right-tail inner attachment →
      //      left-tail inner attachment (tiny sweep across bottom).
      //   4. Left tail: mirror of right.
      //   5. Long top arc: left-tail outer attachment → top of circle.
      const R = params.radius;
      const tailLen = params.tailLength;
      const spanRad = (params.tailSpanDeg * Math.PI) / 180;
      const spreadRad = (params.tailSpreadDeg * Math.PI) / 180;
      const notch = params.notchDepth;
      // Small fixed angular gap between the two inner attachments so
      // the tails don't share a single point on the circle — a shared
      // point would collapse arc2 to zero length and put a degenerate
      // joint at the polygon's seam.
      const GAP_RAD = Math.PI / 18; // 10°

      // Angles measured CCW from +X axis; in Y-down screen coords
      // θ = π/2 is the bottom of the circle and θ = 3π/2 is the top.
      const rightInnerTheta = Math.PI / 2 - GAP_RAD / 2;
      const rightOuterTheta = rightInnerTheta - spanRad;
      const leftInnerTheta = Math.PI / 2 + GAP_RAD / 2;
      const leftOuterTheta = leftInnerTheta + spanRad;

      const circlePt = (theta: number): Point => ({
        x: center.x + R * Math.cos(theta),
        y: center.y + R * Math.sin(theta),
      });

      // Tail axis = "straight down", rotated by `spread` toward the
      // outside. Rotating (0, 1) CW-visually (which is CCW in the math
      // sense used by 2D rotation matrices under Y-down) gives
      // (sin φ, cos φ). The right tail uses +sin φ (splays right),
      // the left tail negates it.
      const rightAxisX = Math.sin(spreadRad);
      const rightAxisY = Math.cos(spreadRad);
      const leftAxisX = -rightAxisX;
      const leftAxisY = rightAxisY;

      const rightOuterTop = circlePt(rightOuterTheta);
      const rightInnerTop = circlePt(rightInnerTheta);
      const leftInnerTop = circlePt(leftInnerTheta);
      const leftOuterTop = circlePt(leftOuterTheta);

      const rightOuterBottom: Point = {
        x: rightOuterTop.x + rightAxisX * tailLen,
        y: rightOuterTop.y + rightAxisY * tailLen,
      };
      const rightInnerBottom: Point = {
        x: rightInnerTop.x + rightAxisX * tailLen,
        y: rightInnerTop.y + rightAxisY * tailLen,
      };
      // Notch = midpoint of the tail's bottom edge pulled inward
      // (toward the medallion) by `notch`. Inward = -tail axis.
      const rightNotch: Point = {
        x: (rightOuterBottom.x + rightInnerBottom.x) / 2 - rightAxisX * notch,
        y: (rightOuterBottom.y + rightInnerBottom.y) / 2 - rightAxisY * notch,
      };

      const leftOuterBottom: Point = {
        x: leftOuterTop.x + leftAxisX * tailLen,
        y: leftOuterTop.y + leftAxisY * tailLen,
      };
      const leftInnerBottom: Point = {
        x: leftInnerTop.x + leftAxisX * tailLen,
        y: leftInnerTop.y + leftAxisY * tailLen,
      };
      const leftNotch: Point = {
        x: (leftOuterBottom.x + leftInnerBottom.x) / 2 - leftAxisX * notch,
        y: (leftOuterBottom.y + leftInnerBottom.y) / 2 - leftAxisY * notch,
      };

      // 40 segments for each long top arc + 4 for the short bottom
      // arc = 84 segments of arc, well below the firmware's practical
      // polygon-complexity limit. Matches the smoothness level of
      // certificate (5 × 10-segment scallops = 50 segments).
      const TOP_ARC_SEGMENTS = 40;
      const BOTTOM_ARC_SEGMENTS = 4;

      // arc1: top (θ = 3π/2) → past right → rightOuterTop. End angle is
      // `rightOuterTheta + 2π` so the sweep moves forward (θ increasing)
      // through the 2π = 0 seam without backtracking.
      const arc1 = arcPoints(
        center,
        R,
        (3 * Math.PI) / 2,
        rightOuterTheta + 2 * Math.PI,
        TOP_ARC_SEGMENTS,
      );
      // arc2: rightInnerTop → leftInnerTop across the bottom of the
      // circle — tiny sweep of GAP_RAD radians.
      const arc2 = arcPoints(
        center,
        R,
        rightInnerTheta,
        leftInnerTheta,
        BOTTOM_ARC_SEGMENTS,
      );
      // arc3: leftOuterTop → top of circle (θ = 3π/2).
      const arc3 = arcPoints(
        center,
        R,
        leftOuterTheta,
        (3 * Math.PI) / 2,
        TOP_ARC_SEGMENTS,
      );

      // Each arcPoints call returns [start … end] inclusive. The seams
      // between arcs and tail vertices already share endpoints so we
      // concatenate directly — no slicing. makePolygon closes the
      // polygon by duplicating the first vertex; arc3's final point
      // coincides with arc1's first point, so the closing segment is
      // zero-length and harmless.
      const points: Point[] = [
        ...arc1,
        rightOuterBottom,
        rightNotch,
        rightInnerBottom,
        ...arc2,
        leftInnerBottom,
        leftNotch,
        leftOuterBottom,
        ...arc3,
      ];
      return makePolygon(points, style);
    },
  },

  // ---------------------------------------------------------------------------
  // v1.0.4 — Others
  // ---------------------------------------------------------------------------
  {
    id: 'plus',
    label: 'Plus',
    category: 'others',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'size', label: 'Size (px)', defaultValue: 200, min: 1, unit: 'px'},
      {id: 'thickness', label: 'Arm (px)', defaultValue: 60, min: 1, unit: 'px'},
    ],
    build: (center, params, style) => {
      const hs = params.size / 2;
      const ht = params.thickness / 2;
      // Trace the + outline clockwise starting from top-left of the
      // top arm. Twelve vertices — the minimum for a symmetric plus.
      return makePolygon(
        [
          {x: center.x - ht, y: center.y - hs},
          {x: center.x + ht, y: center.y - hs},
          {x: center.x + ht, y: center.y - ht},
          {x: center.x + hs, y: center.y - ht},
          {x: center.x + hs, y: center.y + ht},
          {x: center.x + ht, y: center.y + ht},
          {x: center.x + ht, y: center.y + hs},
          {x: center.x - ht, y: center.y + hs},
          {x: center.x - ht, y: center.y + ht},
          {x: center.x - hs, y: center.y + ht},
          {x: center.x - hs, y: center.y - ht},
          {x: center.x - ht, y: center.y - ht},
        ],
        style,
      );
    },
  },

  {
    id: 'lightning',
    label: 'Lightning',
    category: 'others',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'width', label: 'Width (px)', defaultValue: 140, min: 1, unit: 'px'},
      {id: 'height', label: 'Height (px)', defaultValue: 260, min: 1, unit: 'px'},
    ],
    build: (center, params, style) => {
      const hw = params.width / 2;
      const hh = params.height / 2;
      // Six-vertex bolt: two jagged inner kinks create the classic
      // "flash" silhouette. Coordinates are in fractions of the half-
      // extents so the bolt scales naturally with width/height.
      return makePolygon(
        [
          {x: center.x - hw * 0.3, y: center.y - hh},
          {x: center.x + hw * 0.7, y: center.y - hh * 0.1},
          {x: center.x + hw * 0.1, y: center.y - hh * 0.1},
          {x: center.x + hw * 0.3, y: center.y + hh},
          {x: center.x - hw * 0.7, y: center.y + hh * 0.1},
          {x: center.x - hw * 0.1, y: center.y + hh * 0.1},
        ],
        style,
      );
    },
  },

  {
    id: 'trapezoid',
    label: 'Trapezoid',
    // Belongs in the 'others' bucket (not 'basic') so the existing
    // v1.0.3-Basic-shape-set regression test in __tests__/shapes.test.ts
    // doesn't need a pin-bump. Users still find it quickly — "Others"
    // is the most-scrolled-to bucket for misc primitives.
    category: 'others',
    geometryType: 'GEO_polygon',
    parameters: [
      {id: 'width', label: 'Width (px)', defaultValue: 240, min: 1, unit: 'px'},
      {id: 'height', label: 'Height (px)', defaultValue: 160, min: 1, unit: 'px'},
      {id: 'topOffset', label: 'Top Inset (px)', defaultValue: 50, min: 0, unit: 'px'},
    ],
    build: (center, params, style) => {
      const hw = params.width / 2;
      const hh = params.height / 2;
      const o = params.topOffset;
      return makePolygon(
        [
          {x: center.x - hw + o, y: center.y - hh},
          {x: center.x + hw - o, y: center.y - hh},
          {x: center.x + hw, y: center.y + hh},
          {x: center.x - hw, y: center.y + hh},
        ],
        style,
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Category helpers
// ---------------------------------------------------------------------------

/**
 * Normalise `shape.category` to a list. `category` can be either a
 * single `ShapeCategory` or an array when the shape is cross-listed in
 * multiple groups (e.g. a rectangle is both "basic" and, later, a
 * "flowchart" process box). Callers that need membership checks should
 * go through this helper rather than `Array.isArray` inline, so the
 * multi-category convention lives in one place.
 */
export function shapeCategories(shape: Shape): readonly ShapeCategory[] {
  const c = shape.category;
  return Array.isArray(c) ? c : [c as ShapeCategory];
}

/**
 * Shapes that belong to the given category, preserving SHAPES ordering.
 * Used by the palette to render the filtered grid for the current
 * carousel group. Returns a fresh array so callers can safely sort /
 * slice without mutating SHAPES.
 *
 * NOTE: 'favorites' is a user-curated bucket whose membership is not
 * declared on `Shape.category` — pass the user's favorites list to
 * `favoriteShapes()` instead. Calling this with 'favorites' returns
 * an empty array (no shape declares that category statically).
 */
export function shapesInCategory(category: ShapeCategory): Shape[] {
  return SHAPES.filter(s => shapeCategories(s).includes(category));
}

/**
 * Resolve the user's favorites list to actual Shape objects, preserving
 * the user's insertion order (most recently favorited first). Unknown
 * IDs — e.g. left over from a removed shape in a future release — are
 * silently dropped so the palette never tries to render a missing icon.
 *
 * Kept in shapes.ts (not the storage module) because it's a pure
 * domain operation over the shape catalogue; the storage module owns
 * persistence only.
 */
export function favoriteShapes(favorites: readonly ShapeId[]): Shape[] {
  // O(F) over favorites with O(1) catalogue lookup — fine at the spec's
  // 30-favorite cap and well below the 30 × SHAPES.length naive scan.
  const byId = new Map<ShapeId, Shape>(SHAPES.map(s => [s.id, s]));
  return favorites
    .map(id => byId.get(id))
    .filter((s): s is Shape => s !== undefined);
}

// ---------------------------------------------------------------------------
// Favorites — pure helpers
// ---------------------------------------------------------------------------
// Live in shapes.ts (not favoritesStorage.ts) because they operate on
// ShapeIds and contain no persistence concerns — keeping the storage
// adapter focused purely on serialisation / I/O (single responsibility).

/** Maximum favorites a user may pin. Mirrored in favoritesStorage. */
export const MAX_FAVORITES = 30;

/** True iff `shapeId` is in the favorites list. */
export function isFavorite(
  shapeId: ShapeId,
  favorites: readonly ShapeId[],
): boolean {
  return favorites.includes(shapeId);
}

/**
 * Add a shape to favorites, preserving uniqueness and "most recent
 * first" ordering. Returns a new array (never mutates input) so callers
 * can use the result as a React state value safely. Idempotent: adding
 * an already-favorited shape returns the input unchanged. Hard-caps at
 * MAX_FAVORITES — over-cap adds return the input unchanged (caller is
 * expected to surface an error to the user).
 */
export function addFavorite(
  shapeId: ShapeId,
  favorites: readonly ShapeId[],
): readonly ShapeId[] {
  if (favorites.includes(shapeId)) {return favorites;}
  if (favorites.length >= MAX_FAVORITES) {return favorites;}
  return [shapeId, ...favorites];
}

/**
 * Remove a shape from favorites. Returns a new array; does not mutate
 * input. Idempotent: removing a non-favorite returns the input unchanged.
 */
export function removeFavorite(
  shapeId: ShapeId,
  favorites: readonly ShapeId[],
): readonly ShapeId[] {
  if (!favorites.includes(shapeId)) {return favorites;}
  return favorites.filter(id => id !== shapeId);
}

/**
 * Toggle a shape's favorite state. Returns the new favorites array and
 * a status flag — 'added' / 'removed' / 'capped' (over MAX_FAVORITES)
 * — so the caller can surface an error banner without reimplementing
 * the cap check. Single funnel for the heart-toggle handler in the
 * palette, which keeps the UI free of favorites bookkeeping logic.
 */
export type ToggleFavoriteResult = {
  favorites: readonly ShapeId[];
  status: 'added' | 'removed' | 'capped';
};

export function toggleFavorite(
  shapeId: ShapeId,
  favorites: readonly ShapeId[],
): ToggleFavoriteResult {
  if (favorites.includes(shapeId)) {
    return {favorites: removeFavorite(shapeId, favorites), status: 'removed'};
  }
  if (favorites.length >= MAX_FAVORITES) {
    return {favorites, status: 'capped'};
  }
  return {favorites: addFavorite(shapeId, favorites), status: 'added'};
}

/**
 * Produce the next category in CATEGORY_ORDER, wrapping at the ends.
 * `direction` of +1 advances to the next group; -1 goes to the previous.
 * Pure so carousel navigation can be unit-tested without rendering.
 *
 * Throws if `current` is not in CATEGORY_ORDER — callers are expected to
 * pass a known category, so a silent fallback would mask bugs.
 */
export function nextCategory(
  current: ShapeCategory,
  direction: 1 | -1,
): ShapeCategory {
  const idx = CATEGORY_ORDER.indexOf(current);
  if (idx < 0) {throw new Error(`unknown category: ${current}`);}
  const n = CATEGORY_ORDER.length;
  return CATEGORY_ORDER[(idx + direction + n) % n];
}

