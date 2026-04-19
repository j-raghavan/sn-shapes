import {
  SHAPES,
  regularPolygon,
  roundedRectPoints,
  Point,
  Geometry,
  PolygonGeometry,
  CircleGeometry,
  EllipseGeometry,
  LineGeometry,
  PEN_DEFAULTS,
} from '../src/shapes';

const CENTER: Point = {x: 100, y: 100};

function buildShape(id: string): Geometry {
  const shape = SHAPES.find(s => s.id === id);
  if (!shape) {throw new Error(`unknown shape id: ${id}`);}
  const params = Object.fromEntries(shape.parameters.map(p => [p.id, p.defaultValue]));
  return shape.build(CENTER, params, PEN_DEFAULTS);
}

function expectPenDefaults(geo: Geometry) {
  expect(geo.penColor).toBe(0x00);
  expect(geo.penType).toBe(10);
  // PEN_DEFAULTS.penWidth bumped 400 → 500 on 2026-04-18 when
  // WIDTH_PRESETS collapsed to 5 XS/S/M/L/XL entries — the new default
  // lands on the M preset so the Shapes popup highlights it at mount.
  expect(geo.penWidth).toBe(500);
}

function assertPolygon(geo: Geometry): asserts geo is PolygonGeometry {
  expect(geo.type).toBe('GEO_polygon');
}

function assertCircle(geo: Geometry): asserts geo is CircleGeometry {
  expect(geo.type).toBe('GEO_circle');
}

function assertEllipse(geo: Geometry): asserts geo is EllipseGeometry {
  expect(geo.type).toBe('GEO_ellipse');
}

// LineGeometry helper kept importable so future tests can type-narrow
// on a straightLine return without widening `geo`. Referenced below.
function assertLine(geo: Geometry): asserts geo is LineGeometry {
  expect(geo.type).toBe('straightLine');
}

function expectSymmetric(points: Point[], center: Point) {
  const avgX = points.reduce((s, p) => s + p.x, 0) / points.length;
  const avgY = points.reduce((s, p) => s + p.y, 0) / points.length;
  expect(avgX).toBeCloseTo(center.x, 0);
  expect(avgY).toBeCloseTo(center.y, 0);
}

describe('regularPolygon', () => {
  it('generates correct number of points', () => {
    for (let sides = 3; sides <= 8; sides++) {
      expect(regularPolygon(CENTER, 50, sides)).toHaveLength(sides);
    }
  });

  it('places all points at the given radius', () => {
    const points = regularPolygon(CENTER, 50, 6);
    points.forEach(p => {
      const dist = Math.sqrt((p.x - CENTER.x) ** 2 + (p.y - CENTER.y) ** 2);
      expect(dist).toBeCloseTo(50, 5);
    });
  });

  it('first point is at startAngle', () => {
    const points = regularPolygon(CENTER, 50, 4, 0);
    expect(points[0].x).toBeCloseTo(CENTER.x + 50);
    expect(points[0].y).toBeCloseTo(CENTER.y);
  });

  it('defaults to startAngle -PI/2 (top)', () => {
    const points = regularPolygon(CENTER, 50, 4);
    expect(points[0].x).toBeCloseTo(CENTER.x);
    expect(points[0].y).toBeCloseTo(CENTER.y - 50);
  });

  it('is centered around the given center', () => {
    expectSymmetric(regularPolygon(CENTER, 50, 6), CENTER);
  });
});

describe('roundedRectPoints', () => {
  it('generates points for 4 corners with segments', () => {
    const points = roundedRectPoints(CENTER, 50, 30, 10, 4);
    expect(points).toHaveLength(4 * (4 + 1));
  });

  it('clamps corner radius to half-width/height', () => {
    const small = roundedRectPoints(CENTER, 10, 10, 100, 4);
    const normal = roundedRectPoints(CENTER, 10, 10, 10, 4);
    expect(small).toHaveLength(normal.length);
    small.forEach((p, i) => {
      expect(p.x).toBeCloseTo(normal[i].x, 5);
      expect(p.y).toBeCloseTo(normal[i].y, 5);
    });
  });

  it('points are within bounding box', () => {
    const hw = 50;
    const hh = 30;
    const points = roundedRectPoints(CENTER, hw, hh, 8);
    points.forEach(p => {
      expect(p.x).toBeGreaterThanOrEqual(CENTER.x - hw - 0.01);
      expect(p.x).toBeLessThanOrEqual(CENTER.x + hw + 0.01);
      expect(p.y).toBeGreaterThanOrEqual(CENTER.y - hh - 0.01);
      expect(p.y).toBeLessThanOrEqual(CENTER.y + hh + 0.01);
    });
  });
});

describe('SHAPES', () => {
  it('each shape has a unique id', () => {
    const ids = SHAPES.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each shape has a non-empty label', () => {
    SHAPES.forEach(s => {
      expect(s.label.length).toBeGreaterThan(0);
    });
  });

  it('does not include star (reserved Supernote glyph)', () => {
    expect(SHAPES.some(s => s.id === ('star' as unknown))).toBe(false);
  });

  it('includes the v1.0.2 committed 12-shape set exactly', () => {
    // After the 2026-04-18 revert ("revert all the additional shapes you
    // added… show only the Older shapes that were in v1.0.2"), SHAPES
    // must match the HEAD shape list — no 3D additions, no square /
    // right-triangle / trapezoid / arrow / cross extras.
    const ids = SHAPES.map(s => s.id).sort();
    expect(ids).toEqual(
      [
        'circle',
        'diamond',
        'ellipse',
        'heptagon',
        'hexagon',
        'line',
        'octagon',
        'parallelogram',
        'pentagon',
        'rectangle',
        'roundedRect',
        'triangle',
      ].sort(),
    );
  });

  describe.each(SHAPES.map(s => [s.id, s] as const))('%s', (_, shape) => {
    const params = Object.fromEntries(shape.parameters.map(p => [p.id, p.defaultValue]));
    const geo = shape.build(CENTER, params, PEN_DEFAULTS);

    it('build returns a single Geometry object', () => {
      expect(Array.isArray(geo)).toBe(false);
      expect(geo).toBeTruthy();
      expect(typeof geo.type).toBe('string');
    });

    it('has default pen properties', () => {
      expectPenDefaults(geo);
    });

    it('has a recognised type', () => {
      switch (geo.type) {
        case 'GEO_polygon':
          expect(geo.points.length).toBeGreaterThanOrEqual(3);
          break;
        case 'straightLine':
          expect(geo.points).toHaveLength(2);
          break;
        case 'GEO_circle':
        case 'GEO_ellipse':
          expect(geo.ellipseCenterPoint).toBeDefined();
          expect(geo.ellipseMajorAxisRadius).toBeGreaterThan(0);
          expect(geo.ellipseMinorAxisRadius).toBeGreaterThan(0);
          expect(geo.ellipseAngle).toBeDefined();
          break;
        default:
          throw new Error(`unknown geometry type ${(geo as Geometry).type}`);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Shape-specific invariants
  // -------------------------------------------------------------------------
  it('rectangle has 5 points (closed polygon)', () => {
    const geo = buildShape('rectangle');
    assertPolygon(geo);
    expect(geo.points).toHaveLength(5);
    expect(geo.points[0]).toEqual(geo.points[4]);
    const xs = geo.points.slice(0, 4).map(p => p.x);
    const ys = geo.points.slice(0, 4).map(p => p.y);
    expect(new Set(xs).size).toBe(2);
    expect(new Set(ys).size).toBe(2);
  });

  it('circle has equal radii', () => {
    const geo = buildShape('circle');
    assertCircle(geo);
    expect(geo.ellipseMajorAxisRadius).toBe(geo.ellipseMinorAxisRadius);
  });

  it('ellipse has different radii', () => {
    const geo = buildShape('ellipse');
    assertEllipse(geo);
    expect(geo.ellipseMajorAxisRadius).not.toBe(geo.ellipseMinorAxisRadius);
  });

  it('diamond has 5 points (closed) forming a rotated square', () => {
    const geo = buildShape('diamond');
    assertPolygon(geo);
    expect(geo.points).toHaveLength(5);
    expect(geo.points[0]).toEqual(geo.points[4]);
    expect(geo.points[0].x).toBeCloseTo(CENTER.x);
    expect(geo.points[0].y).toBeLessThan(CENTER.y);
  });

  it('triangle has 4 points (closed)', () => {
    const geo = buildShape('triangle');
    assertPolygon(geo);
    expect(geo.points).toHaveLength(4);
    expect(geo.points[0]).toEqual(geo.points[3]);
  });

  it('parallelogram has parallel top/bottom widths', () => {
    const geo = buildShape('parallelogram');
    assertPolygon(geo);
    expect(geo.points).toHaveLength(5);
    expect(geo.points[0]).toEqual(geo.points[4]);
    const topWidth = geo.points[1].x - geo.points[0].x;
    const bottomWidth = geo.points[2].x - geo.points[3].x;
    expect(topWidth).toBeCloseTo(bottomWidth, 5);
  });

  it('line has exactly 2 points', () => {
    const geo = buildShape('line');
    assertLine(geo);
    expect(geo.points).toHaveLength(2);
  });

  it('roundedRect has more than 4 points', () => {
    const geo = buildShape('roundedRect');
    assertPolygon(geo);
    expect(geo.points.length).toBeGreaterThan(4);
  });

  it.each([
    ['pentagon', 6],
    ['hexagon', 7],
    ['heptagon', 8],
    ['octagon', 9],
  ])('%s has %d points (closed)', (id, expected) => {
    const geo = buildShape(id);
    assertPolygon(geo);
    expect(geo.points).toHaveLength(expected);
    expect(geo.points[0]).toEqual(geo.points[expected - 1]);
  });
});
