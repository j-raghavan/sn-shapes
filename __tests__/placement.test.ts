/**
 * Unit tests for src/placement — the pure gesture → geometry rules behind
 * tap-to-place / drag-to-size (issue #15, ADR-PEN-PLACEMENT). Each test
 * pins one FR/AC from spec/SPEC-PEN-PLACEMENT.md F1.
 */
import {
  DRAG_THRESHOLD_PX,
  fitRectUniform,
  isDragGesture,
  MIN_DRAG_SIDE_PX,
  PageSize,
  pageToTouch,
  placeGeometry,
  resizeGeometryTo,
  resolvePlacementTarget,
  touchToPage,
} from '../src/placement';
import {geometryNaturalBounds, Geometry, Rect} from '../src/lassoTransform';
import {PEN_DEFAULTS, SHAPES} from '../src/shapes';

const PAGE: PageSize = {width: 1404, height: 1872};

function expectRectClose(a: Rect | null, b: Rect) {
  expect(a).not.toBeNull();
  expect(a!.left).toBeCloseTo(b.left, 6);
  expect(a!.right).toBeCloseTo(b.right, 6);
  expect(a!.top).toBeCloseTo(b.top, 6);
  expect(a!.bottom).toBeCloseTo(b.bottom, 6);
}

/** Drag target whose from/to run top-left → bottom-right of `rect`. */
function drag(rect: Rect) {
  return {
    kind: 'drag' as const,
    rect,
    from: {x: rect.left, y: rect.top},
    to: {x: rect.right, y: rect.bottom},
  };
}

function buildDefault(id: string): Geometry {
  const shape = SHAPES.find(s => s.id === id)!;
  const params = Object.fromEntries(shape.parameters.map(p => [p.id, p.defaultValue]));
  return shape.build({x: 700, y: 900}, params, PEN_DEFAULTS) as Geometry;
}

describe('touchToPage (FR1.2)', () => {
  it('multiplies both coordinates by the scale', () => {
    expect(touchToPage({x: 10, y: 20}, 2)).toEqual({x: 20, y: 40});
  });

  it.each([0, -1, NaN, Infinity])('falls back to scale 1 for %p', bad => {
    expect(touchToPage({x: 10, y: 20}, bad)).toEqual({x: 10, y: 20});
  });
});

describe('pageToTouch (#17)', () => {
  it('divides both coordinates by the scale (inverse of touchToPage)', () => {
    expect(pageToTouch({x: 20, y: 40}, 2)).toEqual({x: 10, y: 20});
    expect(pageToTouch(touchToPage({x: 7, y: 9}, 3), 3)).toEqual({x: 7, y: 9});
  });

  it.each([0, -1, NaN, Infinity])('falls back to scale 1 for %p', bad => {
    expect(pageToTouch({x: 10, y: 20}, bad)).toEqual({x: 10, y: 20});
  });
});

describe('isDragGesture', () => {
  it('is false below the default threshold and true at it', () => {
    expect(isDragGesture({x: 0, y: 0}, {x: 15, y: 0})).toBe(false);
    expect(isDragGesture({x: 0, y: 0}, {x: 16, y: 0})).toBe(true);
  });

  it('honours an explicit threshold', () => {
    expect(isDragGesture({x: 0, y: 0}, {x: 3, y: 4}, 6)).toBe(false);
    expect(isDragGesture({x: 0, y: 0}, {x: 3, y: 4}, 5)).toBe(true);
  });
});

describe('resolvePlacementTarget (FR1.3)', () => {
  it('AC1.5: a 15 px diagonal drag is a tap; 16 px is a drag', () => {
    const d = 15 / Math.SQRT2;
    expect(resolvePlacementTarget({x: 100, y: 100}, {x: 100 + d, y: 100 + d}, PAGE).kind).toBe('tap');
    const e = 16 / Math.SQRT2;
    expect(resolvePlacementTarget({x: 100, y: 100}, {x: 100 + e, y: 100 + e}, PAGE).kind).toBe('drag');
  });

  it('tap reports the pen-DOWN point, clamped to the page', () => {
    const t = resolvePlacementTarget({x: -5, y: 2000}, {x: 0, y: 2000}, PAGE);
    expect(t).toEqual({kind: 'tap', point: {x: 0, y: PAGE.height}});
  });

  it('AC1.6: corner order does not change the rect; from/to keep gesture order', () => {
    const a = resolvePlacementTarget({x: 100, y: 100}, {x: 300, y: 500}, PAGE);
    const b = resolvePlacementTarget({x: 300, y: 500}, {x: 100, y: 100}, PAGE);
    const rect = {left: 100, top: 100, right: 300, bottom: 500};
    expect(a).toEqual({kind: 'drag', rect, from: {x: 100, y: 100}, to: {x: 300, y: 500}});
    expect(b).toEqual({kind: 'drag', rect, from: {x: 300, y: 500}, to: {x: 100, y: 100}});
  });

  it('non-finite coordinates degrade to a tap at the page centre', () => {
    const centre = {kind: 'tap', point: {x: PAGE.width / 2, y: PAGE.height / 2}};
    expect(resolvePlacementTarget({x: NaN, y: 10}, {x: 10, y: 10}, PAGE)).toEqual(centre);
    expect(resolvePlacementTarget({x: 10, y: Infinity}, {x: 10, y: 10}, PAGE)).toEqual(centre);
    expect(resolvePlacementTarget({x: 10, y: 10}, {x: -Infinity, y: 10}, PAGE)).toEqual(centre);
    expect(resolvePlacementTarget({x: 10, y: 10}, {x: 10, y: NaN}, PAGE)).toEqual(centre);
  });

  it('AC1.7: a purely horizontal 200 px drag gets MIN_DRAG_SIDE_PX height around its row', () => {
    const t = resolvePlacementTarget({x: 100, y: 400}, {x: 300, y: 400}, PAGE);
    expect(t).toEqual({
      kind: 'drag',
      rect: {left: 100, right: 300, top: 400 - MIN_DRAG_SIDE_PX / 2, bottom: 400 + MIN_DRAG_SIDE_PX / 2},
      from: {x: 100, y: 400},
      to: {x: 300, y: 400},
    });
  });

  it('a 16 px diagonal drag floors both sides to MIN_DRAG_SIDE_PX', () => {
    const e = 16 / Math.SQRT2;
    const t = resolvePlacementTarget({x: 100, y: 100}, {x: 100 + e, y: 100 + e}, PAGE);
    expect(t.kind).toBe('drag');
    const r = (t as {rect: Rect}).rect;
    expect(r.right - r.left).toBeCloseTo(MIN_DRAG_SIDE_PX, 6);
    expect(r.bottom - r.top).toBeCloseTo(MIN_DRAG_SIDE_PX, 6);
  });

  it('AC1.8: a drag partly off-page is clamped to the page', () => {
    const t = resolvePlacementTarget({x: -50, y: -50}, {x: 200, y: 300}, PAGE);
    expect(t).toEqual({
      kind: 'drag', rect: {left: 0, top: 0, right: 200, bottom: 300},
      from: {x: 0, y: 0}, to: {x: 200, y: 300},
    });
  });

  it('AC1.8: a drag entirely off-page collapses to the page edge with minSide sides, shifted inward', () => {
    const t = resolvePlacementTarget({x: -100, y: 2000}, {x: -20, y: 2100}, PAGE);
    expect(t).toMatchObject({
      kind: 'drag',
      rect: {
        left: 0,
        right: MIN_DRAG_SIDE_PX,
        top: PAGE.height - MIN_DRAG_SIDE_PX,
        bottom: PAGE.height,
      },
      from: {x: 0, y: PAGE.height},
      to: {x: 0, y: PAGE.height},
    });
  });

  it('shifts inward rather than truncating when the floor crosses the origin', () => {
    // Vertical 200 px drag hugging x=0: width floor would extend to x=-8.
    const t = resolvePlacementTarget({x: 0, y: 100}, {x: 0, y: 300}, PAGE);
    expect(t).toMatchObject({kind: 'drag', rect: {left: 0, right: MIN_DRAG_SIDE_PX, top: 100, bottom: 300}});
  });

  it('never returns a negative edge on a page smaller than minSide', () => {
    const tiny: PageSize = {width: 4, height: 4};
    const t = resolvePlacementTarget({x: 0, y: 0}, {x: 4, y: 4}, tiny, {threshold: 1});
    expect(t).toMatchObject({kind: 'drag', rect: {left: 0, top: 0, right: 4, bottom: 4}});
  });

  it('honours explicit threshold and minSide options', () => {
    const t = resolvePlacementTarget({x: 10, y: 10}, {x: 14, y: 10}, PAGE, {threshold: 2, minSide: 40});
    expect(t).toMatchObject({kind: 'drag', rect: {left: 0, right: 40, top: 0, bottom: 40}});
  });

  it('exports the documented defaults', () => {
    expect(DRAG_THRESHOLD_PX).toBe(16);
    expect(MIN_DRAG_SIDE_PX).toBe(16);
  });
});

describe('placeGeometry — tap (FR1.4)', () => {
  it('centres the natural bounds on the tap point', () => {
    const g = buildDefault('rectangle');
    const out = placeGeometry(g, {kind: 'tap', point: {x: 400, y: 600}}, PAGE);
    expectRectClose(geometryNaturalBounds(out), {left: 300, right: 500, top: 500, bottom: 700});
  });

  it('AC1.4: a tap near the origin keeps the shape on-page', () => {
    const g = buildDefault('rectangle');
    const out = placeGeometry(g, {kind: 'tap', point: {x: 10, y: 10}}, PAGE);
    expectRectClose(geometryNaturalBounds(out), {left: 0, right: 200, top: 0, bottom: 200});
  });

  it('a tap near the far corner keeps the shape on-page', () => {
    const g = buildDefault('rectangle');
    const out = placeGeometry(g, {kind: 'tap', point: {x: 1400, y: 1870}}, PAGE);
    expectRectClose(geometryNaturalBounds(out), {left: 1204, right: 1404, top: 1672, bottom: 1872});
  });

  it('a shape larger than the page is aligned to the page origin', () => {
    const g = buildDefault('rectangle');
    const out = placeGeometry(g, {kind: 'tap', point: {x: 50, y: 50}}, {width: 100, height: 100});
    expectRectClose(geometryNaturalBounds(out), {left: 0, right: 200, top: 0, bottom: 200});
  });

  it('moves a circle without changing its radius', () => {
    const g = buildDefault('circle');
    const out = placeGeometry(g, {kind: 'tap', point: {x: 300, y: 300}}, PAGE);
    expect(out.ellipseCenterPoint).toEqual({x: 300, y: 300});
    expect(out.ellipseMajorAxisRadius).toBe(g.ellipseMajorAxisRadius);
    expect(out.ellipseMinorAxisRadius).toBe(g.ellipseMinorAxisRadius);
  });

  it('moves the horizontal line (degenerate height) to the tap point', () => {
    const g = buildDefault('line');
    const out = placeGeometry(g, {kind: 'tap', point: {x: 300, y: 300}}, PAGE);
    expectRectClose(geometryNaturalBounds(out), {left: 200, right: 400, top: 300, bottom: 300});
  });
});

describe('placeGeometry — drag (FR1.5)', () => {
  it('AC1.2: rectangle fitted into a 100×400 rect spans exactly that rect', () => {
    const g = buildDefault('rectangle');
    const rect: Rect = {left: 50, top: 60, right: 150, bottom: 460};
    const out = placeGeometry(g, drag(rect), PAGE);
    expectRectClose(geometryNaturalBounds(out), rect);
    expect(out.points).toHaveLength(g.points!.length);
  });

  it('AC1.1/AC1.9: a dragged line runs from pen-down to pen-up (vertical)', () => {
    const g = buildDefault('line');
    const out = placeGeometry(
      g, resolvePlacementTarget({x: 100, y: 100}, {x: 100, y: 500}, PAGE), PAGE,
    );
    expect(out.type).toBe('straightLine');
    expect(out.points).toEqual([{x: 100, y: 100}, {x: 100, y: 500}]);
    expect(out.penWidth).toBe(g.penWidth);
  });

  it('AC1.9: reverse gesture order is preserved for a line', () => {
    const g = buildDefault('line');
    const out = placeGeometry(
      g, resolvePlacementTarget({x: 100, y: 500}, {x: 100, y: 100}, PAGE), PAGE,
    );
    expect(out.points).toEqual([{x: 100, y: 500}, {x: 100, y: 100}]);
  });

  it('AC1.9: a diagonal drag yields a diagonal line, not a box midline', () => {
    const g = buildDefault('line');
    const out = placeGeometry(
      g, resolvePlacementTarget({x: 100, y: 200}, {x: 400, y: 300}, PAGE), PAGE,
    );
    expect(out.points).toEqual([{x: 100, y: 200}, {x: 400, y: 300}]);
  });

  it('AC1.3: circle fitted into 300×100 becomes r=50 at the rect centre, angle preserved', () => {
    const g = {...buildDefault('circle'), ellipseAngle: 30};
    const rect: Rect = {left: 100, top: 200, right: 400, bottom: 300};
    const out = placeGeometry(g, drag(rect), PAGE);
    expect(out.type).toBe('GEO_circle');
    expect(out.ellipseCenterPoint).toEqual({x: 250, y: 250});
    expect(out.ellipseMajorAxisRadius).toBe(50);
    expect(out.ellipseMinorAxisRadius).toBe(50);
    expect(out.ellipseAngle).toBe(30);
  });

  it('an ellipse scales per axis (not forced circular)', () => {
    const g = buildDefault('ellipse');
    const rect: Rect = {left: 0, top: 0, right: 400, bottom: 100};
    const out = placeGeometry(g, drag(rect), PAGE);
    expect(out.type).toBe('GEO_ellipse');
    expectRectClose(geometryNaturalBounds(out), rect);
  });

  it('FR1.6: unknown geometry is returned unchanged and never mutated', () => {
    const g: Geometry = {type: 'GEO_mystery', penColor: 0, penType: 10, penWidth: 500};
    const frozen = Object.freeze({...g});
    expect(placeGeometry(frozen, {kind: 'tap', point: {x: 1, y: 1}}, PAGE)).toBe(frozen);
    expect(placeGeometry(frozen, drag({left: 0, top: 0, right: 10, bottom: 10}), PAGE)).toBe(frozen);
  });

  it('FR1.6: inputs are not mutated on the happy path', () => {
    const g = buildDefault('rectangle');
    const snapshot = JSON.stringify(g);
    placeGeometry(g, drag({left: 0, top: 0, right: 10, bottom: 10}), PAGE);
    placeGeometry(g, {kind: 'tap', point: {x: 5, y: 5}}, PAGE);
    expect(JSON.stringify(g)).toBe(snapshot);
  });
});

describe('keepAspect (#17, SPEC-FREE-RESIZE FR1)', () => {
  const aspect = (r: Rect) => (r.right - r.left) / (r.bottom - r.top);

  it('fitRectUniform: a wide box is height-limited and centred horizontally', () => {
    const natural: Rect = {left: 0, top: 0, right: 100, bottom: 100};
    expectRectClose(
      fitRectUniform(natural, {left: 0, top: 0, right: 600, bottom: 200}),
      {left: 200, top: 0, right: 400, bottom: 200},
    );
  });

  it('fitRectUniform: a tall box is width-limited and centred vertically', () => {
    const natural: Rect = {left: 10, top: 10, right: 60, bottom: 110};
    expectRectClose(
      fitRectUniform(natural, {left: 100, top: 100, right: 200, bottom: 600}),
      {left: 100, top: 250, right: 200, bottom: 450},
    );
  });

  it('fitRectUniform: a box with the same proportions is returned as-is', () => {
    const box: Rect = {left: 5, top: 5, right: 405, bottom: 205};
    expectRectClose(fitRectUniform({left: 0, top: 0, right: 20, bottom: 10}, box), box);
  });

  it.each([
    ['zero height', {left: 0, top: 5, right: 100, bottom: 5}],
    ['zero width', {left: 5, top: 0, right: 5, bottom: 100}],
    ['non-finite', {left: 0, top: 0, right: NaN, bottom: 10}],
  ])('AC1.4: fitRectUniform returns the box for a %s natural rect', (_label, natural) => {
    const box: Rect = {left: 1, top: 2, right: 3, bottom: 4};
    expect(fitRectUniform(natural as Rect, box)).toBe(box);
  });

  it('AC1.2: a square rectangle dragged into 600×200 stays 200×200, centred', () => {
    const g = buildDefault('rectangle');
    const rect: Rect = {left: 100, top: 100, right: 700, bottom: 300};
    const out = placeGeometry(g, drag(rect), PAGE, {keepAspect: true});
    expectRectClose(geometryNaturalBounds(out), {left: 300, top: 100, right: 500, bottom: 300});
  });

  it('AC1.1: without keepAspect the drag still fills the box (3-arg, {} and false agree)', () => {
    const g = buildDefault('rectangle');
    const rect: Rect = {left: 100, top: 100, right: 700, bottom: 300};
    const threeArg = placeGeometry(g, drag(rect), PAGE);
    expectRectClose(geometryNaturalBounds(threeArg), rect);
    expect(placeGeometry(g, drag(rect), PAGE, {})).toEqual(threeArg);
    expect(placeGeometry(g, drag(rect), PAGE, {keepAspect: false})).toEqual(threeArg);
  });

  it('AC1.2: an ellipse keeps its radius ratio', () => {
    const g = buildDefault('ellipse');
    const ratio = g.ellipseMajorAxisRadius! / g.ellipseMinorAxisRadius!;
    const out = placeGeometry(
      g, drag({left: 0, top: 0, right: 900, bottom: 100}), PAGE, {keepAspect: true},
    );
    expect(out.ellipseMajorAxisRadius! / out.ellipseMinorAxisRadius!).toBeCloseTo(ratio, 6);
  });

  it.each(SHAPES.filter(s => s.id !== 'line' && s.id !== 'circle').map(s => s.id))(
    'AC1.2: %s keeps its aspect and fits inside a 500×300 box',
    id => {
      const g = buildDefault(id);
      const box: Rect = {left: 100, top: 100, right: 600, bottom: 400};
      const built = geometryNaturalBounds(g)!;
      const out = geometryNaturalBounds(placeGeometry(g, drag(box), PAGE, {keepAspect: true}))!;
      expect(aspect(out)).toBeCloseTo(aspect(built), 4);
      expect(out.left).toBeGreaterThanOrEqual(box.left - 1e-6);
      expect(out.right).toBeLessThanOrEqual(box.right + 1e-6);
      expect(out.top).toBeGreaterThanOrEqual(box.top - 1e-6);
      expect(out.bottom).toBeLessThanOrEqual(box.bottom + 1e-6);
      expect((out.left + out.right) / 2).toBeCloseTo(350, 6);
      expect((out.top + out.bottom) / 2).toBeCloseTo(250, 6);
    },
  );

  it('AC1.3: circles, lines and taps are unaffected by keepAspect', () => {
    const box: Rect = {left: 100, top: 200, right: 400, bottom: 300};
    for (const id of ['circle', 'line']) {
      const g = buildDefault(id);
      expect(placeGeometry(g, drag(box), PAGE, {keepAspect: true}))
        .toEqual(placeGeometry(g, drag(box), PAGE));
    }
    const g = buildDefault('rectangle');
    const tap = {kind: 'tap' as const, point: {x: 400, y: 600}};
    expect(placeGeometry(g, tap, PAGE, {keepAspect: true})).toEqual(placeGeometry(g, tap, PAGE));
  });
});

describe('resizeGeometryTo (#17, SPEC-FREE-RESIZE FR5)', () => {
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

  it('AC5.2: maps a polygon exactly onto the box', () => {
    const rect: Rect = {left: 50, top: 60, right: 450, bottom: 160};
    expectRectClose(geometryNaturalBounds(resizeGeometryTo(square, drag(rect))!), rect);
  });

  it('AC5.2: scales an ellipse per axis', () => {
    const ellipse: Geometry = {...circle, type: 'GEO_ellipse', ellipseMajorAxisRadius: 120, ellipseMinorAxisRadius: 60};
    const out = resizeGeometryTo(ellipse, drag({left: 0, top: 0, right: 480, bottom: 60}))!;
    expect(out.type).toBe('GEO_ellipse');
    expect(out.ellipseMajorAxisRadius).toBeCloseTo(240, 6);
    expect(out.ellipseMinorAxisRadius).toBeCloseTo(30, 6);
    expect(out.ellipseCenterPoint).toEqual({x: 240, y: 30});
  });

  it('G: a 45° ellipse is approximated — centre on the box centre, type and angle kept', () => {
    const rotated: Geometry = {
      ...circle, type: 'GEO_ellipse', ellipseMajorAxisRadius: 120, ellipseMinorAxisRadius: 60, ellipseAngle: 45,
    };
    const out = resizeGeometryTo(rotated, drag({left: 100, top: 200, right: 700, bottom: 400}))!;
    expect(out.type).toBe('GEO_ellipse');
    expect(out.ellipseAngle).toBe(45);
    expect(out.ellipseCenterPoint!.x).toBeCloseTo(400, 6);
    expect(out.ellipseCenterPoint!.y).toBeCloseTo(300, 6);
    // Approximation, not exact: at 45° both radii get the mean of the two
    // axis scales, so the AABB is not the box.
    const natural = geometryNaturalBounds(rotated)!;
    const sx = 600 / (natural.right - natural.left);
    const sy = 200 / (natural.bottom - natural.top);
    expect(out.ellipseMajorAxisRadius).toBeCloseTo(120 * (sx + sy) / 2, 6);
    expect(out.ellipseMinorAxisRadius).toBeCloseTo(60 * (sx + sy) / 2, 6);
  });

  it('AC5.3: an unevenly stretched circle becomes an ellipse', () => {
    const out = resizeGeometryTo(circle, drag({left: 0, top: 0, right: 400, bottom: 100}))!;
    expect(out.type).toBe('GEO_ellipse');
    expect(out.ellipseMajorAxisRadius).toBeCloseTo(200, 6);
    expect(out.ellipseMinorAxisRadius).toBeCloseTo(50, 6);
  });

  it('AC5.3: a uniformly stretched circle stays a circle', () => {
    const out = resizeGeometryTo(circle, drag({left: 0, top: 0, right: 300, bottom: 300}))!;
    expect(out.type).toBe('GEO_circle');
    expect(out.ellipseMajorAxisRadius).toBeCloseTo(150, 6);
  });

  it('AC5.3: sub-epsilon float noise does not flip a circle to an ellipse', () => {
    const out = resizeGeometryTo(circle, drag({left: 0, top: 0, right: 1000, bottom: 1000 + 1e-7}))!;
    expect(out.ellipseMajorAxisRadius).not.toBe(out.ellipseMinorAxisRadius);
    expect(out.type).toBe('GEO_circle');
  });

  it('AC5.2: preserves pen props and unknown extras', () => {
    const g: Geometry = {...square, extra: 'kept'};
    const out = resizeGeometryTo(g, drag({left: 0, top: 0, right: 10, bottom: 20}))!;
    expect(out).toMatchObject({...pen, extra: 'kept', type: 'GEO_polygon'});
  });

  it('F: a line follows the pen, in gesture order, like an insert-time drag', () => {
    const line: Geometry = {type: 'straightLine', ...pen, points: [{x: 0, y: 0}, {x: 10, y: 10}]};
    const target = resolvePlacementTarget({x: 300, y: 150}, {x: 100, y: 100}, PAGE);
    expect(target.kind).toBe('drag');
    const out = resizeGeometryTo(line, target as ReturnType<typeof drag>)!;
    expect(out.points).toEqual([{x: 300, y: 150}, {x: 100, y: 100}]);
    expect(out).toEqual(placeGeometry(line, target, PAGE));
  });

  it('F: the zero-height horizontal Line follows the pen too', () => {
    const line = buildDefault('line');
    const target = resolvePlacementTarget({x: 100, y: 500}, {x: 400, y: 200}, PAGE);
    const out = resizeGeometryTo(line, target as ReturnType<typeof drag>)!;
    expect(out.points).toEqual([{x: 100, y: 500}, {x: 400, y: 200}]);
    expect(out.penWidth).toBe(line.penWidth);
  });

  it('M: returns null when every point coincides (nothing to stretch)', () => {
    const dot: Geometry = {type: 'GEO_polygon', ...pen, points: [{x: 5, y: 5}, {x: 5, y: 5}]};
    expect(resizeGeometryTo(dot, drag({left: 0, top: 0, right: 100, bottom: 100}))).toBeNull();
    const dotLine: Geometry = {type: 'straightLine', ...pen, points: [{x: 5, y: 5}, {x: 5, y: 5}]};
    expect(resizeGeometryTo(dotLine, drag({left: 0, top: 0, right: 100, bottom: 100}))).toBeNull();
  });

  it('a single degenerate axis is still resized (translated on that axis)', () => {
    const flat: Geometry = {type: 'GEO_polygon', ...pen, points: [{x: 0, y: 5}, {x: 100, y: 5}]};
    const out = resizeGeometryTo(flat, drag({left: 0, top: 0, right: 200, bottom: 100}))!;
    expectRectClose(geometryNaturalBounds(out), {left: 0, top: 50, right: 200, bottom: 50});
  });

  it.each([
    ['an unknown type', {type: 'GEO_mystery', ...pen} as Geometry],
    ['a malformed ellipse', {type: 'GEO_ellipse', ...pen} as Geometry],
  ])('AC5.4: returns null for %s', (_label, g) => {
    expect(resizeGeometryTo(g, drag({left: 0, top: 0, right: 10, bottom: 10}))).toBeNull();
  });

  it.each([
    ['non-finite', {left: 0, top: 0, right: NaN, bottom: 10}],
    ['inverted horizontally', {left: 10, top: 0, right: 0, bottom: 10}],
    ['inverted vertically', {left: 0, top: 10, right: 10, bottom: 0}],
  ])('AC5.4: returns null for a %s box', (_label, rect) => {
    expect(resizeGeometryTo(square, drag(rect as Rect))).toBeNull();
  });

  it('AC5.4: never mutates its input', () => {
    const snapshot = JSON.stringify(circle);
    resizeGeometryTo(circle, drag({left: 0, top: 0, right: 400, bottom: 100}));
    expect(JSON.stringify(circle)).toBe(snapshot);
  });
});
