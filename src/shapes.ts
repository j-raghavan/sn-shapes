export type Point = {x: number; y: number};

export type PenStyle = {
  penColor: number;
  penType: number;
  penWidth: number;
};

export type PolygonGeometry = PenStyle & {
  type: 'GEO_polygon';
  points: Point[];
};

export type CircleGeometry = PenStyle & {
  type: 'GEO_circle';
  ellipseCenterPoint: Point;
  ellipseMajorAxisRadius: number;
  ellipseMinorAxisRadius: number;
  ellipseAngle: number;
};

export type EllipseGeometry = PenStyle & {
  type: 'GEO_ellipse';
  ellipseCenterPoint: Point;
  ellipseMajorAxisRadius: number;
  ellipseMinorAxisRadius: number;
  ellipseAngle: number;
};

export type LineGeometry = PenStyle & {
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

export type ShapeParameter = {
  readonly id: string;
  readonly label: string;
  readonly defaultValue: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit: 'px' | 'deg' | '%';
};

export type Shape = {
  readonly id: ShapeId;
  readonly label: string;
  readonly parameters: readonly ShapeParameter[];
  build: (center: Point, params: Record<string, number>, style: PenStyle) => Geometry;
};

export const PEN_DEFAULTS: PenStyle = {
  penColor: 0x00,
  penType: 10,
  penWidth: 400,
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
