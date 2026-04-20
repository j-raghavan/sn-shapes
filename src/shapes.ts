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
  | 'parallelogram';

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
export type ShapeCategory = 'basic' | 'arrows' | '3d' | 'flowchart' | 'others';

export const CATEGORY_ORDER: readonly ShapeCategory[] = [
  'basic',
  'arrows',
  '3d',
  'flowchart',
  'others',
];

export const CATEGORY_LABELS: Record<ShapeCategory, string> = {
  basic: 'Basic Shapes',
  arrows: 'Arrows',
  '3d': '3D Shapes',
  flowchart: 'Flowchart',
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
 * Build output: a single Geometry for primitive shapes (rectangle,
 * circle, …), or a tuple of Geometries for composites (cube, cylinder,
 * arrow-with-head, …). The firmware's `insertGeometry` accepts one
 * Geometry per call, so the palette's insert path loops over the array.
 *
 * Composite ordering convention: emit *hidden* or *decorative* primitives
 * first and the *primary silhouette* last. Firmware can only auto-lasso
 * one element after insert (multi-selection is unsupported as of Chauvet
 * 3.27.41), so the caller applies `showLassoAfterInsert = true` to the
 * LAST primitive only. Keeping the main outline last means the user's
 * lasso lands on something they'd actually want to drag.
 */
export type ShapeBuildResult = Geometry | readonly Geometry[];

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

function makePolygon(points: Point[], style: PenStyle): PolygonGeometry {
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

export const SHAPES: Shape[] = [
  {
    id: 'rectangle',
    label: 'Rectangle',
    category: 'basic',
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
 */
export function shapesInCategory(category: ShapeCategory): Shape[] {
  return SHAPES.filter(s => shapeCategories(s).includes(category));
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
