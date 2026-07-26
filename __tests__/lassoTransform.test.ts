/**
 * Unit tests for src/lassoTransform. Pure functions, no SDK/RN — each test
 * pins the invariants we rely on for v1.0.2's "preserve lasso resize" fix.
 */
import {
  geometryNaturalBounds,
  applyRectTransform,
  boundsMatch,
  bakeLassoResize,
  defaultLassoTolerance,
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

describe('boundsMatch', () => {
  const base: Rect = {left: 0, top: 0, right: 100, bottom: 100};

  it('returns true for identical rects', () => {
    expect(boundsMatch(base, {...base})).toBe(true);
  });

  it('returns true within default 1px tolerance', () => {
    expect(boundsMatch(base, {left: 0.5, top: 0, right: 100.5, bottom: 100})).toBe(true);
  });

  it('returns false beyond tolerance', () => {
    expect(boundsMatch(base, {left: 0, top: 0, right: 110, bottom: 100})).toBe(false);
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

  it('returns input unchanged when source rect is degenerate', () => {
    const g: Geometry = {
      type: 'GEO_polygon',
      penColor: 0, penType: 10, penWidth: 400,
      points: [{x: 1, y: 1}],
    };
    const degenerate: Rect = {left: 0, top: 0, right: 0, bottom: 10};
    const to: Rect = {left: 5, top: 5, right: 50, bottom: 50};
    expect(applyRectTransform(g, degenerate, to)).toBe(g);
  });
});

describe('defaultLassoTolerance', () => {
  it('returns 10 for default (M) pen width', () => {
    expect(defaultLassoTolerance(400)).toBe(10);
  });

  it('returns 10 for thin pens (XS, S)', () => {
    expect(defaultLassoTolerance(200)).toBe(10);
    expect(defaultLassoTolerance(300)).toBe(10);
  });

  it('scales up for thick pens to absorb stroke padding', () => {
    // penWidth=900 → ceil(900/40) = 23. Observed firmware padding on
    // a thick-stroke parallelogram was up to 17px — 23 gives safety margin.
    expect(defaultLassoTolerance(900)).toBe(23);
    expect(defaultLassoTolerance(600)).toBe(15);
  });

  it('falls back to 10 for invalid penWidth', () => {
    expect(defaultLassoTolerance(0)).toBe(10);
    expect(defaultLassoTolerance(-100)).toBe(10);
    expect(defaultLassoTolerance(NaN)).toBe(10);
    expect(defaultLassoTolerance(Infinity)).toBe(10);
  });
});

describe('bakeLassoResize', () => {
  const circle: Geometry = {
    type: 'GEO_circle',
    penColor: 0, penType: 10, penWidth: 400,
    ellipseCenterPoint: {x: 100, y: 100},
    ellipseMajorAxisRadius: 50,
    ellipseMinorAxisRadius: 50,
    ellipseAngle: 0,
  };

  it('returns input when lassoRect is null', () => {
    expect(bakeLassoResize(circle, null)).toBe(circle);
  });

  it('returns input unchanged when the geometry has no natural bounds', () => {
    const unknownType: Geometry = {type: 'GEO_mystery', penColor: 0, penType: 10, penWidth: 400};
    const someRect: Rect = {left: 0, top: 0, right: 100, bottom: 100};
    expect(bakeLassoResize(unknownType, someRect)).toBe(unknownType);
  });

  it('returns input when lassoRect matches natural bounds within tolerance', () => {
    const matchingRect: Rect = {left: 50, top: 50, right: 150, bottom: 150};
    expect(bakeLassoResize(circle, matchingRect)).toBe(circle);
  });

  it('returns input unchanged when rects match within sub-pixel tolerance', () => {
    const nearlyMatching: Rect = {left: 50.5, top: 50, right: 150, bottom: 150};
    expect(bakeLassoResize(circle, nearlyMatching, 1)).toBe(circle);
  });

  it('returns transformed geometry when lassoRect differs from natural bounds', () => {
    // Lasso was dragged to 2x size.
    const resized: Rect = {left: 0, top: 0, right: 200, bottom: 200};
    const out = bakeLassoResize(circle, resized);
    expect(out).not.toBe(circle);
    expect(out.ellipseMajorAxisRadius).toBe(100);
    expect(out.ellipseMinorAxisRadius).toBe(100);
    expect(out.ellipseCenterPoint).toEqual({x: 100, y: 100});
  });

  it('absorbs firmware stroke-padding (logcat-phase1.txt fixture)', () => {
    // Real fixture from logcat-phase1.txt: a parallelogram inserted at
    // natural bounds 552-852 × 861-1011 with penWidth=900, and the firmware
    // immediately reports a lasso rect of 546-860 × 848-1028 — that 6-17px
    // delta is stroke + miter padding, NOT a user resize. bakeLassoResize
    // must treat this as a no-op; otherwise every modify grows the shape.
    const parallelogram: Geometry = {
      type: 'GEO_polygon',
      penColor: 0, penType: 10, penWidth: 900,
      points: [
        {x: 652, y: 861},
        {x: 852, y: 861},
        {x: 752, y: 1011},
        {x: 552, y: 1011},
        {x: 652, y: 861},
      ],
    };
    const firmwarePaddedLasso: Rect = {left: 546, top: 848, right: 860, bottom: 1028};
    expect(bakeLassoResize(parallelogram, firmwarePaddedLasso)).toBe(parallelogram);
  });

  it('still fires for a genuine user resize on a thick-pen shape', () => {
    // Same parallelogram as above, but user dragged the lasso to ~2x size.
    // The delta (~300px) is well beyond any plausible stroke padding so the
    // bake must fire and scale vertices to the new rect.
    const parallelogram: Geometry = {
      type: 'GEO_polygon',
      penColor: 0, penType: 10, penWidth: 900,
      points: [
        {x: 652, y: 861},
        {x: 852, y: 861},
        {x: 752, y: 1011},
        {x: 552, y: 1011},
        {x: 652, y: 861},
      ],
    };
    const resizedLasso: Rect = {left: 400, top: 700, right: 1000, bottom: 1300};
    const out = bakeLassoResize(parallelogram, resizedLasso);
    expect(out).not.toBe(parallelogram);
    // New vertex AABB should match the resized lasso.
    const newBounds = geometryNaturalBounds(out)!;
    expectRectClose(newBounds, resizedLasso, 1);
  });

  it('explicit tol parameter overrides the penWidth-based default', () => {
    // With penWidth=900 the auto-tol is 23, which would normally swallow
    // this 15px delta. Passing tol=1 forces the strict comparison, so the
    // bake fires.
    const parallelogram: Geometry = {
      type: 'GEO_polygon',
      penColor: 0, penType: 10, penWidth: 900,
      points: [
        {x: 0, y: 0}, {x: 100, y: 0}, {x: 100, y: 100}, {x: 0, y: 100},
      ],
    };
    const slightlyOff: Rect = {left: -7, top: -8, right: 107, bottom: 108};
    // With auto-tol (23): would no-op.
    expect(bakeLassoResize(parallelogram, slightlyOff)).toBe(parallelogram);
    // With explicit 1px tol: bakes.
    expect(bakeLassoResize(parallelogram, slightlyOff, 1)).not.toBe(parallelogram);
  });
});
