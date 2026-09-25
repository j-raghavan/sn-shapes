/**
 * Unit tests for src/lassoTransform. Pure functions, no SDK/RN — bounds,
 * rect remapping (insert-time placement, #15) and the free-resize helpers
 * behind the Edit Shape panel (#17).
 */
import {
  geometryNaturalBounds,
  applyRectTransform,
  isSingleGeometrySelection,
  resizeGeometryTo,
  Rect,
  Geometry,
} from '../src/lassoTransform';

const EPS = 1e-3;

function closeTo(actual: number, expected: number, tol = EPS): boolean {
  return Math.abs(actual - expected) <= tol;
}

function expectRectClose(a: Rect, b: Rect, tol = EPS) {
  expect(closeTo(a.left, b.left, tol)).toBe(true);
  expect(closeTo(a.right, b.right, tol)).toBe(true);
  expect(closeTo(a.top, b.top, tol)).toBe(true);
  expect(closeTo(a.bottom, b.bottom, tol)).toBe(true);
}

describe('geometryNaturalBounds', () => {
  it('returns AABB of an axis-aligned circle', () => {
    const g: Geometry = {
      type: 'GEO_circle',
      penColor: 0, penType: 10, penWidth: 400,
      ellipseCenterPoint: {x: 500, y: 500},
      ellipseMajorAxisRadius: 100,
      ellipseMinorAxisRadius: 100,
      ellipseAngle: 0,
    };
    const bounds = geometryNaturalBounds(g);
    expect(bounds).not.toBeNull();
    expectRectClose(bounds!, {left: 400, right: 600, top: 400, bottom: 600});
  });

  it('returns rotated AABB of a 90°-rotated ellipse (matches logcat fixture)', () => {
    // From real logcat: rMaj=100, rMin=149, angle≈90° → AABB 298×200
    const g: Geometry = {
      type: 'GEO_ellipse',
      penColor: 0, penType: 10, penWidth: 400,
      ellipseCenterPoint: {x: 702, y: 936},
      ellipseMajorAxisRadius: 100,
      ellipseMinorAxisRadius: 149,
      ellipseAngle: 90,
    };
    const bounds = geometryNaturalBounds(g);
    expect(bounds).not.toBeNull();
    expectRectClose(bounds!, {left: 553, right: 851, top: 836, bottom: 1036});
  });

  it('returns AABB of a polygon from its points', () => {
    const g: Geometry = {
      type: 'GEO_polygon',
      penColor: 0, penType: 10, penWidth: 400,
      points: [{x: 10, y: 20}, {x: 30, y: 20}, {x: 30, y: 50}, {x: 10, y: 50}],
    };
    expectRectClose(
      geometryNaturalBounds(g)!,
      {left: 10, right: 30, top: 20, bottom: 50},
    );
  });

  it('finds the AABB when the extreme points are not the first vertex', () => {
    // Ordered so the leftmost/rightmost/topmost/bottommost values each
    // arrive after a vertex that doesn't hold that extreme — exercises
    // every "new min/max found mid-scan" branch, not just the
    // first-vertex initial values.
    const g: Geometry = {
      type: 'GEO_polygon',
      penColor: 0, penType: 10, penWidth: 400,
      points: [
        {x: 0, y: 50},
        {x: -20, y: 0},
        {x: 40, y: 80},
        {x: 5, y: -30},
      ],
    };
    expectRectClose(
      geometryNaturalBounds(g)!,
      {left: -20, right: 40, top: -30, bottom: 80},
    );
  });

  it('returns AABB of a straight line from its endpoints', () => {
    const g: Geometry = {
      type: 'straightLine',
      penColor: 0, penType: 10, penWidth: 400,
      points: [{x: 100, y: 200}, {x: 400, y: 800}],
    };
    expectRectClose(
      geometryNaturalBounds(g)!,
      {left: 100, right: 400, top: 200, bottom: 800},
    );
  });

  it('returns null for unknown geometry type', () => {
    const g: Geometry = {type: 'GEO_mystery', penColor: 0, penType: 10, penWidth: 400};
    expect(geometryNaturalBounds(g)).toBeNull();
  });

  it('returns null for a polygon missing points', () => {
    const g: Geometry = {type: 'GEO_polygon', penColor: 0, penType: 10, penWidth: 400};
    expect(geometryNaturalBounds(g)).toBeNull();
  });

  it('returns null for a circle/ellipse missing its center point', () => {
    const g: Geometry = {
      type: 'GEO_circle',
      penColor: 0, penType: 10, penWidth: 400,
      ellipseMajorAxisRadius: 100,
      ellipseMinorAxisRadius: 100,
    };
    expect(geometryNaturalBounds(g)).toBeNull();
  });

  it('returns null for a circle/ellipse with non-numeric radii', () => {
    const g: Geometry = {
      type: 'GEO_ellipse',
      penColor: 0, penType: 10, penWidth: 400,
      ellipseCenterPoint: {x: 0, y: 0},
      ellipseMajorAxisRadius: 'oops' as unknown as number,
      ellipseMinorAxisRadius: 100,
    };
    expect(geometryNaturalBounds(g)).toBeNull();
  });
});

describe('applyRectTransform', () => {
  it('is a no-op when fromRect === toRect', () => {
    const g: Geometry = {
      type: 'GEO_polygon',
      penColor: 0, penType: 10, penWidth: 400,
      points: [{x: 10, y: 20}, {x: 30, y: 40}],
    };
    const rect: Rect = {left: 10, top: 20, right: 30, bottom: 40};
    const out = applyRectTransform(g, rect, rect);
    expect(out.points).toEqual(g.points);
  });

  it('scales a polygon by 2x in each axis', () => {
    const g: Geometry = {
      type: 'GEO_polygon',
      penColor: 0, penType: 10, penWidth: 400,
      points: [{x: 0, y: 0}, {x: 100, y: 0}, {x: 100, y: 100}, {x: 0, y: 100}],
    };
    const from: Rect = {left: 0, top: 0, right: 100, bottom: 100};
    const to: Rect = {left: 0, top: 0, right: 200, bottom: 200};
    const out = applyRectTransform(g, from, to);
    expect(out.points).toEqual([
      {x: 0, y: 0}, {x: 200, y: 0}, {x: 200, y: 200}, {x: 0, y: 200},
    ]);
  });

  it('scales a polygon non-uniformly and translates', () => {
    const g: Geometry = {
      type: 'GEO_polygon',
      penColor: 0, penType: 10, penWidth: 400,
      points: [{x: 10, y: 10}, {x: 30, y: 30}],
    };
    const from: Rect = {left: 10, top: 10, right: 30, bottom: 30}; // 20×20
    const to: Rect = {left: 100, top: 200, right: 140, bottom: 260}; // 40×60
    const out = applyRectTransform(g, from, to);
    // (10,10) → (100, 200); (30,30) → (140, 260)
    expect(out.points).toEqual([
      {x: 100, y: 200},
      {x: 140, y: 260},
    ]);
  });

  it('scales an axis-aligned circle 2x to become an ellipse-sized circle', () => {
    const g: Geometry = {
      type: 'GEO_circle',
      penColor: 0, penType: 10, penWidth: 400,
      ellipseCenterPoint: {x: 50, y: 50},
      ellipseMajorAxisRadius: 10,
      ellipseMinorAxisRadius: 10,
      ellipseAngle: 0,
    };
    const from: Rect = {left: 40, top: 40, right: 60, bottom: 60};
    const to: Rect = {left: 40, top: 40, right: 80, bottom: 80};
    const out = applyRectTransform(g, from, to);
    // Scale 2x in both axes; center moves from (50,50) to (60,60)
    // because the target rect's center is at 60,60.
    expect(out.ellipseCenterPoint).toEqual({x: 60, y: 60});
    expect(out.ellipseMajorAxisRadius).toBe(20);
    expect(out.ellipseMinorAxisRadius).toBe(20);
    expect(out.ellipseAngle).toBe(0);
  });

  it('scales an axis-aligned ellipse non-uniformly (θ=0: sx→major, sy→minor)', () => {
    const g: Geometry = {
      type: 'GEO_ellipse',
      penColor: 0, penType: 10, penWidth: 400,
      ellipseCenterPoint: {x: 0, y: 0},
      ellipseMajorAxisRadius: 100,
      ellipseMinorAxisRadius: 50,
      ellipseAngle: 0,
    };
    const from: Rect = {left: -100, top: -50, right: 100, bottom: 50};
    const to: Rect = {left: -200, top: -150, right: 200, bottom: 150}; // sx=2, sy=3
    const out = applyRectTransform(g, from, to);
    expect(closeTo(out.ellipseMajorAxisRadius!, 200)).toBe(true); // 100 * sx
    expect(closeTo(out.ellipseMinorAxisRadius!, 150)).toBe(true); // 50 * sy
  });

  it('scales a 90°-rotated ellipse non-uniformly (sx maps to minor, sy to major)', () => {
    const g: Geometry = {
      type: 'GEO_ellipse',
      penColor: 0, penType: 10, penWidth: 400,
      ellipseCenterPoint: {x: 0, y: 0},
      ellipseMajorAxisRadius: 100,
      ellipseMinorAxisRadius: 50,
      ellipseAngle: 90,
    };
    // Natural bounds are 100 wide × 200 tall (major along Y after 90° rot).
    const from: Rect = {left: -50, top: -100, right: 50, bottom: 100};
    const to: Rect = {left: -100, top: -300, right: 100, bottom: 300}; // sx=2, sy=3
    const out = applyRectTransform(g, from, to);
    // At 90°: sMaj = sy = 3, sMin = sx = 2
    expect(closeTo(out.ellipseMajorAxisRadius!, 300)).toBe(true); // 100 * 3
    expect(closeTo(out.ellipseMinorAxisRadius!, 100)).toBe(true); // 50 * 2
  });

  it('approximates a 45°-rotated ellipse with the mean of sx and sy', () => {
    const g: Geometry = {
      type: 'GEO_ellipse',
      penColor: 0, penType: 10, penWidth: 400,
      ellipseCenterPoint: {x: 0, y: 0},
      ellipseMajorAxisRadius: 100,
      ellipseMinorAxisRadius: 100,
      ellipseAngle: 45,
    };
    const from: Rect = {left: -100, top: -100, right: 100, bottom: 100};
    const to: Rect = {left: -300, top: -200, right: 300, bottom: 200}; // sx=3, sy=2
    const out = applyRectTransform(g, from, to);
    // At 45°: sMaj = sMin = (3 + 2) / 2 = 2.5
    expect(closeTo(out.ellipseMajorAxisRadius!, 250)).toBe(true);
    expect(closeTo(out.ellipseMinorAxisRadius!, 250)).toBe(true);
  });

  it('returns input unchanged for unknown type', () => {
    const g: Geometry = {type: 'weird', penColor: 0, penType: 10, penWidth: 400};
    const rect: Rect = {left: 0, top: 0, right: 100, bottom: 100};
    expect(applyRectTransform(g, rect, {...rect, right: 200})).toBe(g);
  });

  it('returns input unchanged for a circle/ellipse missing its center point', () => {
    const g: Geometry = {
      type: 'GEO_circle',
      penColor: 0, penType: 10, penWidth: 400,
      ellipseMajorAxisRadius: 100,
      ellipseMinorAxisRadius: 100,
    };
    const from: Rect = {left: 0, top: 0, right: 100, bottom: 100};
    const to: Rect = {left: 0, top: 0, right: 200, bottom: 200};
    expect(applyRectTransform(g, from, to)).toBe(g);
  });

  it('returns input unchanged for a circle/ellipse with non-numeric radii', () => {
    const g: Geometry = {
      type: 'GEO_ellipse',
      penColor: 0, penType: 10, penWidth: 400,
      ellipseCenterPoint: {x: 0, y: 0},
      ellipseMajorAxisRadius: 100,
      ellipseMinorAxisRadius: 'oops' as unknown as number,
    };
    const from: Rect = {left: -100, top: -100, right: 100, bottom: 100};
    const to: Rect = {left: -200, top: -200, right: 200, bottom: 200};
    expect(applyRectTransform(g, from, to)).toBe(g);
  });

  it('returns input unchanged for a polygon/line missing its points array', () => {
    const g: Geometry = {type: 'GEO_polygon', penColor: 0, penType: 10, penWidth: 400};
    const from: Rect = {left: 0, top: 0, right: 100, bottom: 100};
    const to: Rect = {left: 0, top: 0, right: 200, bottom: 200};
    expect(applyRectTransform(g, from, to)).toBe(g);
  });

  it('translates a degenerate source axis to the target midpoint and scales the other', () => {
    const g: Geometry = {
      type: 'GEO_polygon',
      penColor: 0, penType: 10, penWidth: 400,
      points: [{x: 0, y: 0}, {x: 0, y: 10}],
    };
    // Zero-width source: x is translated (mid 0 → mid 27.5); y still scales 0..10 → 5..50.
    const degenerate: Rect = {left: 0, top: 0, right: 0, bottom: 10};
    const to: Rect = {left: 5, top: 5, right: 50, bottom: 50};
    const out = applyRectTransform(g, degenerate, to);
    expect(out).not.toBe(g);
    expect(out.points).toEqual([{x: 27.5, y: 5}, {x: 27.5, y: 50}]);
  });

  it('translates purely when both source axes are degenerate', () => {
    const g: Geometry = {
      type: 'GEO_ellipse',
      penColor: 0, penType: 10, penWidth: 400,
      ellipseCenterPoint: {x: 3, y: 4},
      ellipseMajorAxisRadius: 7,
      ellipseMinorAxisRadius: 2,
      ellipseAngle: 45,
    };
    const point: Rect = {left: 3, top: 4, right: 3, bottom: 4};
    const to: Rect = {left: 100, top: 200, right: 100, bottom: 200};
    const out = applyRectTransform(g, point, to);
    expect(out.ellipseCenterPoint).toEqual({x: 100, y: 200});
    expect(out.ellipseMajorAxisRadius).toBe(7);
    expect(out.ellipseMinorAxisRadius).toBe(2);
    expect(out.ellipseAngle).toBe(45);
  });
});

describe('isSingleGeometrySelection (#17, AC5.1)', () => {
  it('degrades to the geometry list when counts are unavailable', () => {
    expect(isSingleGeometrySelection(null, 1)).toBe(true);
    expect(isSingleGeometrySelection(null, 0)).toBe(false);
    expect(isSingleGeometrySelection(null, 2)).toBe(false);
  });

  it('accepts exactly one geometry and nothing else', () => {
    expect(isSingleGeometrySelection({geometryNum: 1}, 1)).toBe(true);
    expect(isSingleGeometrySelection({geometryNum: 1, trailNum: 0, titleNum: 0}, 1)).toBe(true);
  });

  it('rejects when counts report more than one geometry', () => {
    expect(isSingleGeometrySelection({geometryNum: 2}, 1)).toBe(false);
    expect(isSingleGeometrySelection({}, 1)).toBe(false);
  });

  it('rejects when the geometry list disagrees with the counts', () => {
    expect(isSingleGeometrySelection({geometryNum: 1}, 2)).toBe(false);
  });

  it.each([
    'trailNum', 'titleNum', 'bitmapNum', 'normalTextBoxNum', 'digestTextBoxNum',
    'digestTextBoxEditableNum', 'trailLinkNum', 'textLinkNum', 'todoLinkNum',
  ])('rejects a mixed selection with %s > 0', field => {
    expect(isSingleGeometrySelection({geometryNum: 1, [field]: 1}, 1)).toBe(false);
  });

  it('ignores geometry subtype counts', () => {
    expect(
      isSingleGeometrySelection({geometryNum: 1, circleNum: 1, ellipseNum: 1, straightLineNum: 1}, 1),
    ).toBe(true);
  });

  it('treats non-number fields as absent', () => {
    expect(isSingleGeometrySelection({geometryNum: 1, trailNum: 'x'}, 1)).toBe(true);
  });
});

describe('resizeGeometryTo (#17)', () => {
  const pen = {penColor: 0x9d, penType: 10, penWidth: 400};
  const square: Geometry = {
    type: 'GEO_polygon', ...pen,
    points: [{x: 0, y: 0}, {x: 100, y: 0}, {x: 100, y: 100}, {x: 0, y: 100}, {x: 0, y: 0}],
  };
  const circle: Geometry = {
    type: 'GEO_circle', ...pen,
    ellipseCenterPoint: {x: 500, y: 500},
    ellipseMajorAxisRadius: 100, ellipseMinorAxisRadius: 100, ellipseAngle: 0,
  };

  it('AC5.2: maps a polygon exactly onto the target', () => {
    const target: Rect = {left: 50, top: 60, right: 450, bottom: 160};
    expectRectClose(geometryNaturalBounds(resizeGeometryTo(square, target)!)!, target);
  });

  it('AC5.2: scales an ellipse per axis', () => {
    const ellipse: Geometry = {...circle, type: 'GEO_ellipse', ellipseMajorAxisRadius: 120, ellipseMinorAxisRadius: 60};
    const out = resizeGeometryTo(ellipse, {left: 0, top: 0, right: 480, bottom: 60})!;
    expect(out.type).toBe('GEO_ellipse');
    expect(out.ellipseMajorAxisRadius).toBeCloseTo(240, 6);
    expect(out.ellipseMinorAxisRadius).toBeCloseTo(30, 6);
    expect(out.ellipseCenterPoint).toEqual({x: 240, y: 30});
  });

  it('AC5.3: an unevenly stretched circle becomes an ellipse', () => {
    const out = resizeGeometryTo(circle, {left: 0, top: 0, right: 400, bottom: 100})!;
    expect(out.type).toBe('GEO_ellipse');
    expect(out.ellipseMajorAxisRadius).toBeCloseTo(200, 6);
    expect(out.ellipseMinorAxisRadius).toBeCloseTo(50, 6);
  });

  it('AC5.3: a uniformly stretched circle stays a circle', () => {
    const out = resizeGeometryTo(circle, {left: 0, top: 0, right: 300, bottom: 300})!;
    expect(out.type).toBe('GEO_circle');
    expect(out.ellipseMajorAxisRadius).toBeCloseTo(150, 6);
  });

  it('AC5.3: sub-epsilon float noise does not flip a circle to an ellipse', () => {
    const out = resizeGeometryTo(circle, {left: 0, top: 0, right: 1000, bottom: 1000 + 1e-7})!;
    expect(out.ellipseMajorAxisRadius).not.toBe(out.ellipseMinorAxisRadius);
    expect(out.type).toBe('GEO_circle');
  });

  it('AC5.2: preserves pen props and unknown extras', () => {
    const g: Geometry = {...square, extra: 'kept'};
    const out = resizeGeometryTo(g, {left: 0, top: 0, right: 10, bottom: 20})!;
    expect(out).toMatchObject({...pen, extra: 'kept', type: 'GEO_polygon'});
  });

  it('maps a diagonal straight line into the target', () => {
    const line: Geometry = {type: 'straightLine', ...pen, points: [{x: 0, y: 0}, {x: 10, y: 10}]};
    expect(resizeGeometryTo(line, {left: 100, top: 100, right: 300, bottom: 150})!.points)
      .toEqual([{x: 100, y: 100}, {x: 300, y: 150}]);
  });

  it.each([
    ['an unknown type', {type: 'GEO_mystery', ...pen} as Geometry],
    ['a malformed ellipse', {type: 'GEO_ellipse', ...pen} as Geometry],
  ])('AC5.4: returns null for %s', (_label, g) => {
    expect(resizeGeometryTo(g, {left: 0, top: 0, right: 10, bottom: 10})).toBeNull();
  });

  it.each([
    ['non-finite', {left: 0, top: 0, right: NaN, bottom: 10}],
    ['inverted horizontally', {left: 10, top: 0, right: 0, bottom: 10}],
    ['inverted vertically', {left: 0, top: 10, right: 10, bottom: 0}],
  ])('AC5.4: returns null for a %s target', (_label, target) => {
    expect(resizeGeometryTo(square, target as Rect)).toBeNull();
  });

  it('AC5.4: never mutates its input', () => {
    const snapshot = JSON.stringify(circle);
    resizeGeometryTo(circle, {left: 0, top: 0, right: 400, bottom: 100});
    expect(JSON.stringify(circle)).toBe(snapshot);
  });
});
