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
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  ShapeCategory,
  shapeCategories,
  shapesInCategory,
  nextCategory,
} from '../src/shapes';

const CENTER: Point = {x: 100, y: 100};

/**
 * Build a shape by id with defaults + the default pen style. As of
 * v1.0.4 every shape builds exactly one Geometry, so this is a thin
 * convenience wrapper for the per-shape invariants below.
 */
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

  it('Basic category contains the v1.0.3 12-shape set exactly', () => {
    // Carry-over regression guard from v1.0.2 / v1.0.3: the Basic
    // category must still contain precisely the original 12 primitive
    // shapes. v1.0.4 introduces other categories (Arrows, Flowchart,
    // Decorative, Others) via the `category` field, but this test pins
    // the Basic set so an accidental re-tagging (e.g. moving rectangle
    // out of Basic when cross-listing it in Flowchart) is caught
    // immediately.
    const basicIds = shapesInCategory('basic')
      .map(s => s.id)
      .sort();
    expect(basicIds).toEqual(
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
    // v1.0.4: `ShapeBuildResult` is a single Geometry. The multi-
    // Geometry composite path was removed because the firmware lasso
    // can only grab one element at a time — so every shape now authors
    // itself as one closed polygon / circle / ellipse / line.
    const geo = shape.build(CENTER, params, PEN_DEFAULTS);

    it('build returns a single Geometry with a recognised type', () => {
      expect(geo).toBeTruthy();
      expect(typeof geo.type).toBe('string');
    });

    it('carries the default pen properties', () => {
      expectPenDefaults(geo);
    });

    it('geometry type matches a supported firmware primitive', () => {
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

    it('declares at least one valid category', () => {
      const categories = shapeCategories(shape);
      expect(categories.length).toBeGreaterThanOrEqual(1);
      categories.forEach(c => {
        expect(CATEGORY_ORDER).toContain(c);
      });
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

// ---------------------------------------------------------------------------
// Category model (v1.0.4)
// ---------------------------------------------------------------------------

describe('ShapeCategory model', () => {
  it('CATEGORY_ORDER has a label for every entry', () => {
    // Record<ShapeCategory, string> already enforces this at compile
    // time; the runtime check catches accidental mutations / casts.
    CATEGORY_ORDER.forEach(c => {
      expect(CATEGORY_LABELS[c]).toBeTruthy();
      expect(typeof CATEGORY_LABELS[c]).toBe('string');
    });
  });

  it('CATEGORY_ORDER entries are unique', () => {
    expect(new Set(CATEGORY_ORDER).size).toBe(CATEGORY_ORDER.length);
  });

  it('shapeCategories normalises a scalar category to a 1-item list', () => {
    const shape = SHAPES.find(s => s.id === 'rectangle')!;
    const result = shapeCategories(shape);
    expect(result).toEqual(['basic']);
  });

  it('shapesInCategory("basic") returns all v1.0.3 primitives', () => {
    const ids = shapesInCategory('basic').map(s => s.id);
    expect(ids).toContain('rectangle');
    expect(ids).toContain('circle');
    expect(ids).toContain('line');
    expect(ids).toHaveLength(12);
  });

  it('shapesInCategory preserves SHAPES ordering', () => {
    const basic = shapesInCategory('basic');
    const basicSubsetFromShapes = SHAPES.filter(s =>
      shapeCategories(s).includes('basic'),
    );
    expect(basic.map(s => s.id)).toEqual(basicSubsetFromShapes.map(s => s.id));
  });

  it('shapesInCategory does not mutate SHAPES', () => {
    const beforeLen = SHAPES.length;
    const result = shapesInCategory('basic');
    result.push(SHAPES[0]); // mutate the returned array
    expect(SHAPES).toHaveLength(beforeLen);
  });

  it('nextCategory advances forward with wrap-around', () => {
    // basic → arrows → flowchart → decorative → others → basic
    const forward: ShapeCategory[] = [];
    let c: ShapeCategory = 'basic';
    for (let i = 0; i < CATEGORY_ORDER.length; i++) {
      c = nextCategory(c, 1);
      forward.push(c);
    }
    // After N steps forward we're back at the start.
    expect(forward[forward.length - 1]).toBe('basic');
  });

  it('nextCategory reverses with wrap-around', () => {
    // basic -1 → others (last element)
    expect(nextCategory('basic', -1)).toBe(
      CATEGORY_ORDER[CATEGORY_ORDER.length - 1],
    );
    // others +1 → basic (wraps)
    expect(nextCategory(CATEGORY_ORDER[CATEGORY_ORDER.length - 1], 1)).toBe(
      'basic',
    );
  });

  it('nextCategory throws on an unknown category', () => {
    expect(() => nextCategory('bogus' as ShapeCategory, 1)).toThrow();
  });
});
