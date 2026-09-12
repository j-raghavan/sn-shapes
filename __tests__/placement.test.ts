/**
 * Unit tests for src/placement — the pure gesture → geometry rules behind
 * tap-to-place / drag-to-size (issue #15, ADR-PEN-PLACEMENT). Each test
 * pins one FR/AC from spec/SPEC-PEN-PLACEMENT.md F1.
 */
import {
  DRAG_THRESHOLD_PX,
  MIN_DRAG_SIDE_PX,
  PageSize,
  placeGeometry,
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

  it('AC1.6: corner order does not matter', () => {
    const a = resolvePlacementTarget({x: 100, y: 100}, {x: 300, y: 500}, PAGE);
    const b = resolvePlacementTarget({x: 300, y: 500}, {x: 100, y: 100}, PAGE);
    expect(a).toEqual(b);
    expect(a).toEqual({kind: 'drag', rect: {left: 100, top: 100, right: 300, bottom: 500}});
  });

  it('AC1.7: a purely horizontal 200 px drag gets MIN_DRAG_SIDE_PX height around its row', () => {
    const t = resolvePlacementTarget({x: 100, y: 400}, {x: 300, y: 400}, PAGE);
    expect(t).toEqual({
      kind: 'drag',
      rect: {left: 100, right: 300, top: 400 - MIN_DRAG_SIDE_PX / 2, bottom: 400 + MIN_DRAG_SIDE_PX / 2},
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
    expect(t).toEqual({kind: 'drag', rect: {left: 0, top: 0, right: 200, bottom: 300}});
  });

  it('AC1.8: a drag entirely off-page collapses to the page edge with minSide sides, shifted inward', () => {
    const t = resolvePlacementTarget({x: -100, y: 2000}, {x: -20, y: 2100}, PAGE);
    expect(t).toEqual({
      kind: 'drag',
      rect: {
        left: 0,
        right: MIN_DRAG_SIDE_PX,
        top: PAGE.height - MIN_DRAG_SIDE_PX,
        bottom: PAGE.height,
      },
    });
  });

  it('shifts inward rather than truncating when the floor crosses the origin', () => {
    // Vertical 200 px drag hugging x=0: width floor would extend to x=-8.
    const t = resolvePlacementTarget({x: 0, y: 100}, {x: 0, y: 300}, PAGE);
    expect(t).toEqual({kind: 'drag', rect: {left: 0, right: MIN_DRAG_SIDE_PX, top: 100, bottom: 300}});
  });

  it('never returns a negative edge on a page smaller than minSide', () => {
    const tiny: PageSize = {width: 4, height: 4};
    const t = resolvePlacementTarget({x: 0, y: 0}, {x: 4, y: 4}, tiny, {threshold: 1});
    expect(t).toEqual({kind: 'drag', rect: {left: 0, top: 0, right: 4, bottom: 4}});
  });

  it('honours explicit threshold and minSide options', () => {
    const t = resolvePlacementTarget({x: 10, y: 10}, {x: 14, y: 10}, PAGE, {threshold: 2, minSide: 40});
    expect(t).toEqual({kind: 'drag', rect: {left: 0, right: 40, top: 0, bottom: 40}});
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
    const out = placeGeometry(g, {kind: 'drag', rect}, PAGE);
    expectRectClose(geometryNaturalBounds(out), rect);
    expect(out.points).toHaveLength(g.points!.length);
  });

  it('AC1.1: horizontal line fitted into 300×100 spans left→right on the vertical midline', () => {
    const g = buildDefault('line');
    const rect: Rect = {left: 100, top: 200, right: 400, bottom: 300};
    const out = placeGeometry(g, {kind: 'drag', rect}, PAGE);
    const xs = out.points!.map(p => p.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(100, 6);
    expect(xs[1]).toBeCloseTo(400, 6);
    for (const p of out.points!) {expect(p.y).toBeCloseTo(250, 6);}
  });

  it('AC1.3: circle fitted into 300×100 becomes r=50 at the rect centre, angle preserved', () => {
    const g = {...buildDefault('circle'), ellipseAngle: 30};
    const rect: Rect = {left: 100, top: 200, right: 400, bottom: 300};
    const out = placeGeometry(g, {kind: 'drag', rect}, PAGE);
    expect(out.type).toBe('GEO_circle');
    expect(out.ellipseCenterPoint).toEqual({x: 250, y: 250});
    expect(out.ellipseMajorAxisRadius).toBe(50);
    expect(out.ellipseMinorAxisRadius).toBe(50);
    expect(out.ellipseAngle).toBe(30);
  });

  it('an ellipse scales per axis (not forced circular)', () => {
    const g = buildDefault('ellipse');
    const rect: Rect = {left: 0, top: 0, right: 400, bottom: 100};
    const out = placeGeometry(g, {kind: 'drag', rect}, PAGE);
    expect(out.type).toBe('GEO_ellipse');
    expectRectClose(geometryNaturalBounds(out), rect);
  });

  it('FR1.6: unknown geometry is returned unchanged and never mutated', () => {
    const g: Geometry = {type: 'GEO_mystery', penColor: 0, penType: 10, penWidth: 500};
    const frozen = Object.freeze({...g});
    expect(placeGeometry(frozen, {kind: 'tap', point: {x: 1, y: 1}}, PAGE)).toBe(frozen);
    expect(placeGeometry(frozen, {kind: 'drag', rect: {left: 0, top: 0, right: 10, bottom: 10}}, PAGE)).toBe(frozen);
  });

  it('FR1.6: inputs are not mutated on the happy path', () => {
    const g = buildDefault('rectangle');
    const snapshot = JSON.stringify(g);
    placeGeometry(g, {kind: 'drag', rect: {left: 0, top: 0, right: 10, bottom: 10}}, PAGE);
    placeGeometry(g, {kind: 'tap', point: {x: 5, y: 5}}, PAGE);
    expect(JSON.stringify(g)).toBe(snapshot);
  });
});
