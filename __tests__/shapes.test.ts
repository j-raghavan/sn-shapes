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
  ShapeId,
  shapeCategories,
  shapesInCategory,
  favoriteShapes,
  isFavorite,
  addFavorite,
  removeFavorite,
  toggleFavorite,
  MAX_FAVORITES,
  nextCategory,
  arcPoints,
  ellipseArcPoints,
  obliqueDepth,
  buildBoxPoints,
  buildPyramidPoints,
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

// ---------------------------------------------------------------------------
// Pseudo-3D solids — shared test utilities (v1.1.0)
// ---------------------------------------------------------------------------

function bbox(points: Point[]) {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/**
 * Key an undirected edge by its sorted, integer-rounded endpoint pair so
 * float noise (depth-vector arithmetic) doesn't spuriously split one edge
 * into two. Rounding to whole px is well within the solids' vertex spacing.
 */
function edgeKey(a: Point, b: Point): string {
  const ka = `${Math.round(a.x)},${Math.round(a.y)}`;
  const kb = `${Math.round(b.x)},${Math.round(b.y)}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/**
 * Undirected edge multiset of a closed polygon, from its consecutive
 * vertices (the build() point list already has first === last, so iterating
 * consecutive pairs covers the makePolygon closing seam). Zero-length edges
 * — coincident consecutive points, e.g. the cone's apex→apex close (EC5) —
 * are dropped as harmless artefacts.
 */
function edgeCounts(points: Point[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y)) {
      continue; // zero-length seam
    }
    const k = edgeKey(a, b);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/** Sorted list of edges traversed more than once (retraced). */
function retracedEdges(points: Point[]): string[] {
  return [...edgeCounts(points).entries()]
    .filter(([, n]) => n > 1)
    .map(([k]) => k)
    .sort();
}

describe('ellipseArcPoints', () => {
  it('returns segments + 1 points', () => {
    expect(ellipseArcPoints(CENTER, 40, 20, 0, Math.PI, 12)).toHaveLength(13);
  });

  it('places points on the ellipse (rx, ry) about center', () => {
    const rx = 60;
    const ry = 25;
    const pts = ellipseArcPoints(CENTER, rx, ry, 0, 2 * Math.PI, 24);
    pts.forEach(p => {
      const nx = (p.x - CENTER.x) / rx;
      const ny = (p.y - CENTER.y) / ry;
      expect(nx * nx + ny * ny).toBeCloseTo(1, 5);
    });
  });

  it('equals arcPoints when rx === ry (parity, F2-AC3)', () => {
    const r = 50;
    const ell = ellipseArcPoints(CENTER, r, r, 0.3, 2 * Math.PI - 0.3, 16);
    const arc = arcPoints(CENTER, r, 0.3, 2 * Math.PI - 0.3, 16);
    expect(ell).toHaveLength(arc.length);
    ell.forEach((p, i) => {
      expect(p.x).toBeCloseTo(arc[i].x, 9);
      expect(p.y).toBeCloseTo(arc[i].y, 9);
    });
  });

  it('throws when segments < 1', () => {
    expect(() => ellipseArcPoints(CENTER, 10, 5, 0, 1, 0)).toThrow();
  });
});

describe('obliqueDepth', () => {
  it('points up-and-right for a positive angle (F2-AC2)', () => {
    const d = obliqueDepth(100, 30);
    expect(d.dx).toBeGreaterThan(0);
    expect(d.dy).toBeLessThan(0);
  });

  it('has magnitude depth * depthScale (F2-AC2)', () => {
    const depth = 100;
    const d = obliqueDepth(depth, 30);
    const mag = Math.sqrt(d.dx * d.dx + d.dy * d.dy);
    // depthScale === 0.7 (module constant).
    expect(mag).toBeCloseTo(depth * 0.7, 6);
  });

  it('magnitude is independent of angle', () => {
    const a = obliqueDepth(120, 10);
    const b = obliqueDepth(120, 50);
    const magA = Math.sqrt(a.dx * a.dx + a.dy * a.dy);
    const magB = Math.sqrt(b.dx * b.dx + b.dy * b.dy);
    expect(magA).toBeCloseTo(magB, 6);
  });

  it('collapses to (depthScale*depth, 0) at angle 0', () => {
    const d = obliqueDepth(100, 0);
    expect(d.dx).toBeCloseTo(70, 6);
    expect(d.dy).toBeCloseTo(0, 6);
  });
});

describe('buildBoxPoints', () => {
  it('returns the documented 12-vertex Eulerian walk', () => {
    expect(buildBoxPoints(CENTER, 100, 80, 60, 30)).toHaveLength(12);
  });

  it('back vertices equal front vertices plus D', () => {
    const d = obliqueDepth(60, 30);
    const pts = buildBoxPoints(CENTER, 100, 80, 60, 30);
    // Walk index 0 = TL (front), index 5 = TL' (back).
    const TL = pts[0];
    const TLb = pts[5];
    expect(TLb.x - TL.x).toBeCloseTo(d.dx, 6);
    expect(TLb.y - TL.y).toBeCloseTo(d.dy, 6);
  });

  it('is bounding-box centered on center (INV6)', () => {
    const pts = buildBoxPoints(CENTER, 100, 80, 60, 30);
    const b = bbox(pts);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(CENTER.x, 6);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(CENTER.y, 6);
  });
});

describe('buildPyramidPoints', () => {
  it('returns the documented 9-vertex Eulerian walk', () => {
    expect(buildPyramidPoints(CENTER, 100, 90, 60, 30)).toHaveLength(9);
  });

  it('apex is above all base vertices by ~height', () => {
    const height = 90;
    const pts = buildPyramidPoints(CENTER, 100, height, 60, 30);
    const apex = pts[4]; // index 4 = A in the documented walk
    const base = [pts[0], pts[1], pts[2], pts[3]];
    base.forEach(b => expect(apex.y).toBeLessThan(b.y));
    const baseCy = base.reduce((s, p) => s + p.y, 0) / base.length;
    expect(baseCy - apex.y).toBeCloseTo(height, 6);
  });

  it('is bounding-box centered on center (INV6)', () => {
    const pts = buildPyramidPoints(CENTER, 100, 90, 60, 30);
    const b = bbox(pts);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(CENTER.x, 6);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(CENTER.y, 6);
  });
});

describe('cuboid / cube (oblique box family)', () => {
  it('cuboid builds one closed GEO_polygon (F3-AC1)', () => {
    const geo = buildShape('cuboid');
    assertPolygon(geo);
    expect(geo.points[0]).toEqual(geo.points[geo.points.length - 1]);
    expect(geo.points.length).toBeGreaterThanOrEqual(3);
  });

  it('back vertices equal front vertices plus D (F3-AC2)', () => {
    const geo = buildShape('cuboid');
    assertPolygon(geo);
    // Walk order: [TL, TR, BR, BR', TR', TL', TL, ...]. Front TL/TR/BR are
    // indices 0/1/2; their back counterparts TL'/TR'/BR' are 5/4/3.
    const d = obliqueDepth(80, 30); // cuboid default depth/angle
    const pairs: Array<[number, number]> = [
      [0, 5],
      [1, 4],
      [2, 3],
    ];
    pairs.forEach(([f, b]) => {
      expect(geo.points[b].x - geo.points[f].x).toBeCloseTo(d.dx, 4);
      expect(geo.points[b].y - geo.points[f].y).toBeCloseTo(d.dy, 4);
    });
  });

  it('has exactly the 9 visible edges with 3 retraces and no diagonal (F3-AC6)', () => {
    const geo = buildShape('cuboid');
    assertPolygon(geo);
    const counts = edgeCounts(geo.points);
    // 9 distinct visible front/top/right edges.
    expect(counts.size).toBe(9);
    // Exactly three edges traversed twice: TL-TR, BR-BR', BR'-TR'.
    const p = geo.points;
    const TL = p[0];
    const TR = p[1];
    const BRb = p[3];
    const TRb = p[4];
    const BR = p[2];
    const expectedRetraced = [
      edgeKey(TL, TR),
      edgeKey(BR, BRb),
      edgeKey(BRb, TRb),
    ].sort();
    expect(retracedEdges(geo.points)).toEqual(expectedRetraced);
    // No face diagonal: the close must be the real edge TR→TL, never a
    // diagonal such as TR-TL' or TR-BL.
    const BL = p[7];
    const TLb = p[5];
    expect(counts.has(edgeKey(TR, TLb))).toBe(false);
    expect(counts.has(edgeKey(TR, BL))).toBe(false);
  });

  it('cube builds width == height == depth (F3-AC3)', () => {
    const geo = buildShape('cube');
    assertPolygon(geo);
    expect(geo.points[0]).toEqual(geo.points[geo.points.length - 1]);
    // Front face square: |TL-TR| (width) == |TR-BR| (height). Depth edge
    // |BR-BR'| == |D| == size*depthScale; with size==width and the same
    // builder, the box is a cube.
    const p = geo.points;
    const width = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
    const height = Math.hypot(p[2].x - p[1].x, p[2].y - p[1].y);
    expect(width).toBeCloseTo(height, 4);
    expect(width).toBeCloseTo(180, 4); // default size
    const depthEdge = Math.hypot(p[3].x - p[2].x, p[3].y - p[2].y);
    expect(depthEdge).toBeCloseTo(180 * 0.7, 4); // size * depthScale
  });

  it('cuboid is bounding-box centered on center (INV6)', () => {
    const geo = buildShape('cuboid');
    assertPolygon(geo);
    const b = bbox(geo.points);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(CENTER.x, 4);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(CENTER.y, 4);
  });
});

describe('squarePyramid', () => {
  it('builds one closed GEO_polygon (F4-AC1)', () => {
    const geo = buildShape('squarePyramid');
    assertPolygon(geo);
    expect(geo.points[0]).toEqual(geo.points[geo.points.length - 1]);
    expect(geo.points.length).toBeGreaterThanOrEqual(3);
  });

  it('apex lies above all base vertices by ~height (F4-AC2)', () => {
    const geo = buildShape('squarePyramid');
    assertPolygon(geo);
    // Walk order: [BL, BR, BR', BL', A, ...]; apex A is index 4, the four
    // base corners are indices 0..3.
    const p = geo.points;
    const apex = p[4];
    const base = [p[0], p[1], p[2], p[3]];
    base.forEach(b => expect(apex.y).toBeLessThan(b.y));
    const baseCy = base.reduce((s, q) => s + q.y, 0) / base.length;
    expect(baseCy - apex.y).toBeCloseTo(160, 3); // default height
  });

  it('has exactly the 7 visible edges with 2 retraces, hidden BR-A absent (F4-AC4)', () => {
    const geo = buildShape('squarePyramid');
    assertPolygon(geo);
    const counts = edgeCounts(geo.points);
    // 4 base + 3 visible slant = 7 distinct edges.
    expect(counts.size).toBe(7);
    const p = geo.points;
    const BL = p[0];
    const BR = p[1];
    const BRb = p[2];
    const BLb = p[3];
    const A = p[4];
    // Retraced: back-left slant BL'-A (spur) and the front base edge BL-BR
    // (closing seam).
    expect(retracedEdges(geo.points)).toEqual([edgeKey(BLb, A), edgeKey(BL, BR)].sort());
    // The back-right slant BR'-A is hidden — must not be drawn.
    expect(counts.has(edgeKey(BRb, A))).toBe(false);
  });

  it('is bounding-box centered on center (INV6)', () => {
    const geo = buildShape('squarePyramid');
    assertPolygon(geo);
    const b = bbox(geo.points);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(CENTER.x, 4);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(CENTER.y, 4);
  });
});

describe('cylinder', () => {
  it('builds one closed GEO_polygon', () => {
    const geo = buildShape('cylinder');
    assertPolygon(geo);
    expect(geo.points[0]).toEqual(geo.points[geo.points.length - 1]);
  });

  it('retraces no edge (F5-AC1)', () => {
    const geo = buildShape('cylinder');
    assertPolygon(geo);
    expect(retracedEdges(geo.points)).toEqual([]);
  });

  it('bounding box is ~2*radiusX wide and ~height + 2*ry tall (F5-AC2)', () => {
    const geo = buildShape('cylinder');
    assertPolygon(geo);
    const b = bbox(geo.points);
    const rx = 90;
    const height = 200;
    const ry = (rx * 28) / 100;
    expect(b.maxX - b.minX).toBeCloseTo(2 * rx, 3);
    expect(b.maxY - b.minY).toBeCloseTo(height + 2 * ry, 3);
  });

  it('is bounding-box centered on center (INV6 / F5-FR5)', () => {
    const geo = buildShape('cylinder');
    assertPolygon(geo);
    const b = bbox(geo.points);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(CENTER.x, 3);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(CENTER.y, 3);
  });
});

describe('cone', () => {
  it('builds one closed GEO_polygon (F6-AC1)', () => {
    const geo = buildShape('cone');
    assertPolygon(geo);
    expect(geo.points[0]).toEqual(geo.points[geo.points.length - 1]);
  });

  it('fills a bbox centered on center, vertical midpoint == center.y (F6-AC1)', () => {
    const geo = buildShape('cone');
    assertPolygon(geo);
    const b = bbox(geo.points);
    const rx = 90;
    const height = 200;
    const ry = (rx * 28) / 100;
    expect((b.minX + b.maxX) / 2).toBeCloseTo(CENTER.x, 3);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(CENTER.y, 3);
    expect(b.maxX - b.minX).toBeCloseTo(2 * rx, 3);
    expect(b.maxY - b.minY).toBeCloseTo(height + ry, 3);
  });

  it('apex is the topmost vertex, above base extremes by ~height (F6-AC2)', () => {
    const geo = buildShape('cone');
    assertPolygon(geo);
    const apex = geo.points[0];
    // build emits [apex, ...baseFront, apex] and makePolygon appends the
    // closing apex, so the pure base-arc vertices are the interior slice
    // between the first apex and the two trailing apex copies.
    const base = geo.points.slice(1, geo.points.length - 2);
    // Apex is strictly above every base vertex.
    base.forEach(p => expect(apex.y).toBeLessThan(p.y));
    // Axial height: apex to the base centerline. The base front arc starts at
    // the left extreme (angle π), which sits exactly on baseCenter.y (sin 0),
    // so base[0] is the centerline reference vertex.
    const leftBaseExtreme = base[0];
    expect(leftBaseExtreme.y - apex.y).toBeCloseTo(200, 3); // default height
  });

  it('retraces no edge, excluding the zero-length apex close (F6-AC4)', () => {
    const geo = buildShape('cone');
    assertPolygon(geo);
    // edgeCounts drops zero-length seams (the apex→apex close), so this is
    // the F6-AC4 assertion directly.
    expect(retracedEdges(geo.points)).toEqual([]);
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

    it('geometryType field matches the actual build result type', () => {
      // Ensures the static `shape.geometryType` declaration stays in sync
      // with what `build` actually produces. TypeScript enforces the field
      // exists; this test enforces it has the correct value.
      expect(shape.geometryType).toBe(geo.type);
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
    // Walks the full cycle (favorites → basic → … → others → favorites)
    // and asserts we land back where we started after N steps.
    const start: ShapeCategory = CATEGORY_ORDER[0];
    let c: ShapeCategory = start;
    for (let i = 0; i < CATEGORY_ORDER.length; i++) {
      c = nextCategory(c, 1);
    }
    expect(c).toBe(start);
  });

  it('nextCategory reverses with wrap-around', () => {
    const first = CATEGORY_ORDER[0];
    const last = CATEGORY_ORDER[CATEGORY_ORDER.length - 1];
    expect(nextCategory(first, -1)).toBe(last);
    expect(nextCategory(last, 1)).toBe(first);
  });

  it('nextCategory throws on an unknown category', () => {
    expect(() => nextCategory('bogus' as ShapeCategory, 1)).toThrow();
  });

  it('CATEGORY_ORDER lists favorites first', () => {
    // Pin position so future reorders don't silently shuffle the
    // dynamically-populated bucket into the middle of the static set,
    // which would change the "one ◀ tap from basic" landing rule.
    expect(CATEGORY_ORDER[0]).toBe('favorites');
  });

  it('shapesInCategory("favorites") returns an empty static slice', () => {
    // Favorites membership is dynamic; no shape declares the category
    // statically. Callers must use favoriteShapes(list) to resolve the
    // user's pinned shapes.
    expect(shapesInCategory('favorites')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Favorites — pure helpers (v1.0.5)
// ---------------------------------------------------------------------------

describe('favorites helpers', () => {
  const RECT: ShapeId = 'rectangle';
  const CIRCLE: ShapeId = 'circle';
  const TRI: ShapeId = 'triangle';

  describe('isFavorite', () => {
    it('is true when the id is present', () => {
      expect(isFavorite(RECT, [CIRCLE, RECT])).toBe(true);
    });
    it('is false when the id is absent', () => {
      expect(isFavorite(RECT, [CIRCLE])).toBe(false);
    });
    it('is false on an empty list', () => {
      expect(isFavorite(RECT, [])).toBe(false);
    });
  });

  describe('addFavorite', () => {
    it('prepends to favor "most recent first"', () => {
      expect(addFavorite(TRI, [RECT, CIRCLE])).toEqual([TRI, RECT, CIRCLE]);
    });
    it('is idempotent for an already-favorited id', () => {
      const fav = [RECT, CIRCLE];
      expect(addFavorite(RECT, fav)).toBe(fav);
    });
    it('does not mutate the input array', () => {
      const fav: readonly ShapeId[] = [RECT];
      const result = addFavorite(CIRCLE, fav);
      expect(fav).toEqual([RECT]);
      expect(result).not.toBe(fav);
    });
    it('returns the input unchanged when the cap is reached', () => {
      const capped: readonly ShapeId[] = Array.from(
        {length: MAX_FAVORITES},
        (_, i) => `id_${i}` as ShapeId,
      );
      expect(addFavorite(RECT, capped)).toBe(capped);
    });
  });

  describe('removeFavorite', () => {
    it('drops the matching id', () => {
      expect(removeFavorite(RECT, [CIRCLE, RECT, TRI])).toEqual([CIRCLE, TRI]);
    });
    it('is idempotent for a non-member', () => {
      const fav = [CIRCLE];
      expect(removeFavorite(RECT, fav)).toBe(fav);
    });
    it('does not mutate the input array', () => {
      const fav: readonly ShapeId[] = [RECT, CIRCLE];
      const result = removeFavorite(RECT, fav);
      expect(fav).toEqual([RECT, CIRCLE]);
      expect(result).not.toBe(fav);
    });
  });

  describe('toggleFavorite', () => {
    it('returns "added" when the shape is new', () => {
      const r = toggleFavorite(RECT, [CIRCLE]);
      expect(r.status).toBe('added');
      expect(r.favorites).toEqual([RECT, CIRCLE]);
    });
    it('returns "removed" when the shape is already favorited', () => {
      const r = toggleFavorite(RECT, [RECT, CIRCLE]);
      expect(r.status).toBe('removed');
      expect(r.favorites).toEqual([CIRCLE]);
    });
    it('returns "capped" with the input unchanged at the limit', () => {
      const capped: readonly ShapeId[] = Array.from(
        {length: MAX_FAVORITES},
        (_, i) => `id_${i}` as ShapeId,
      );
      const r = toggleFavorite(RECT, capped);
      expect(r.status).toBe('capped');
      expect(r.favorites).toBe(capped);
    });
  });

  describe('favoriteShapes', () => {
    it('preserves the user-supplied order (most recent first)', () => {
      const result = favoriteShapes([CIRCLE, RECT]);
      expect(result.map(s => s.id)).toEqual([CIRCLE, RECT]);
    });
    it('drops unknown ids without throwing', () => {
      const result = favoriteShapes([
        'not_a_real_shape' as ShapeId,
        RECT,
      ]);
      expect(result.map(s => s.id)).toEqual([RECT]);
    });
    it('returns an empty array for an empty list', () => {
      expect(favoriteShapes([])).toEqual([]);
    });
  });
});
