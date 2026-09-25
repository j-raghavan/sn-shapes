/**
 * Unit tests for src/resizeHandles — the pure model behind Edit Shape's
 * handle-based free resize (#17, ADR-FREE-RESIZE).
 */
import {
  applyResize,
  boxHandles,
  dragHandle,
  editsEqual,
  hitTest,
  HANDLE_HIT_PX,
  ResizeEdit,
  resizeFrame,
} from '../src/resizeHandles';
import {geometryNaturalBounds, Geometry, Rect} from '../src/lassoTransform';
import {PageSize} from '../src/placement';
import {PEN_DEFAULTS, SHAPES} from '../src/shapes';

const PAGE: PageSize = {width: 1404, height: 1872};
const pen = {penColor: 0x9d, penType: 10, penWidth: 400};

function polygon(r: Rect, extra: Partial<Geometry> = {}): Geometry {
  return {
    type: 'GEO_polygon', ...pen,
    points: [
      {x: r.left, y: r.top}, {x: r.right, y: r.top}, {x: r.right, y: r.bottom},
      {x: r.left, y: r.bottom}, {x: r.left, y: r.top},
    ],
    ...extra,
  };
}

function box(rect: Rect): ResizeEdit {
  return {kind: 'box', rect};
}

function expectRectClose(a: Rect | null, b: Rect) {
  expect(a).not.toBeNull();
  expect(a!.left).toBeCloseTo(b.left, 6);
  expect(a!.right).toBeCloseTo(b.right, 6);
  expect(a!.top).toBeCloseTo(b.top, 6);
  expect(a!.bottom).toBeCloseTo(b.bottom, 6);
}

const N: Rect = {left: 100, top: 100, right: 300, bottom: 200};
const square = polygon(N);
const circle: Geometry = {
  type: 'GEO_circle', ...pen,
  ellipseCenterPoint: {x: 500, y: 500},
  ellipseMajorAxisRadius: 100, ellipseMinorAxisRadius: 100, ellipseAngle: 0,
};
const hLine: Geometry = {type: 'straightLine', ...pen, points: [{x: 100, y: 500}, {x: 400, y: 500}]};

describe('resizeFrame — the starting box', () => {
  it('minimal input: no lasso rect → handles open on the stored bounds', () => {
    expect(resizeFrame(square, null)).toEqual({stored: N, start: box(N), pending: false});
  });

  it('a fresh lasso (rect = stored + stroke padding) opens on the stored bounds', () => {
    const lasso = {left: 94, top: 95, right: 306, bottom: 207};
    expect(resizeFrame(square, lasso)).toEqual({stored: N, start: box(N), pending: false});
  });

  it('a lasso rect beyond the padding bound is a pending native resize: inset by tol/2', () => {
    const lasso = {left: 92, top: 92, right: 508, bottom: 208};
    const f = resizeFrame(square, lasso)!;
    expect(f.pending).toBe(true);
    expect(f.stored).toEqual(N);
    expect(f.start).toEqual(box({left: 97, top: 97, right: 503, bottom: 203}));
  });

  it('padding just over tol on a fresh lasso (sharp vertices) still opens on the stored bounds', () => {
    // penWidth 400 → tol 10. 9.5 px per side grows the size by 19 ≤ 2·tol,
    // centre fixed.
    const lasso = {left: 90.5, top: 90.5, right: 309.5, bottom: 209.5};
    expect(resizeFrame(square, lasso)).toEqual({stored: N, start: box(N), pending: false});
    // Miter padding past tol on one side (12 px) only nudges the centre (≤ tol).
    const lopsided = {left: 88, top: 95, right: 306, bottom: 205};
    expect(resizeFrame(square, lopsided)!.pending).toBe(false);
  });

  it('a genuine native resize is pending', () => {
    expect(resizeFrame(square, {left: 95, top: 95, right: 330, bottom: 205})!.pending).toBe(true);
    expect(resizeFrame(square, {left: 95, top: 95, right: 305, bottom: 230})!.pending).toBe(true);
  });

  it('a native move (same size, centre shifted) is pending', () => {
    const f = resizeFrame(square, {left: 145, top: 95, right: 355, bottom: 205})!;
    expect(f.pending).toBe(true);
    expect(f.start).toEqual(box({left: 150, top: 100, right: 350, bottom: 200}));
    expect(resizeFrame(square, {left: 95, top: 84, right: 305, bottom: 194})!.pending).toBe(true);
  });

  it('the inset is capped at a quarter of each side so a small rect never collapses', () => {
    const f = resizeFrame(square, {left: 0, top: 0, right: 8, bottom: 40})!;
    expect(f.start).toEqual(box({left: 2, top: 2, right: 6, bottom: 38}));
  });

  it('the padding bound scales with pen width (penWidth 900 → tol 23)', () => {
    const thick = polygon(N, {penWidth: 900});
    const lasso = {left: 78, top: 78, right: 322, bottom: 222};
    expect(resizeFrame(thick, lasso)!.pending).toBe(false);
    expect(resizeFrame(square, lasso)!.pending).toBe(true);
  });

  it('a non-finite pen width falls back to the 10 px bound', () => {
    const g = polygon(N, {penWidth: NaN});
    expect(resizeFrame(g, {left: 90, top: 90, right: 310, bottom: 210})!.pending).toBe(false);
    expect(resizeFrame(g, {left: 89, top: 90, right: 310, bottom: 210})!.pending).toBe(true);
    expect(resizeFrame(g, {left: 111, top: 100, right: 311, bottom: 200})!.pending).toBe(true);
  });

  it.each([
    ['non-finite', {left: NaN, top: 0, right: 10, bottom: 10}],
    ['inverted', {left: 500, top: 100, right: 100, bottom: 200}],
  ])('a %s lasso rect is ignored (degrades to the stored bounds)', (_label, lasso) => {
    expect(resizeFrame(square, lasso as Rect)).toEqual({stored: N, start: box(N), pending: false});
  });

  it.each([
    ['an unknown type', {type: 'GEO_mystery', ...pen} as Geometry],
    ['a malformed ellipse', {type: 'GEO_ellipse', ...pen} as Geometry],
    ['every point coincident', polygon({left: 5, top: 5, right: 5, bottom: 5})],
    ['a non-finite point', polygon({left: 0, top: 0, right: NaN, bottom: 10})],
  ])('returns null for %s', (_label, g) => {
    expect(resizeFrame(g, null)).toBeNull();
  });

  it('a flat polygon (zero height) resizes width only; zero width resizes height only', () => {
    const flat = polygon({left: 100, top: 200, right: 300, bottom: 200});
    expect(resizeFrame(flat, null)!.start).toEqual({kind: 'box', rect: {left: 100, top: 200, right: 300, bottom: 200}, resizes: 'x'});
    const tall = polygon({left: 50, top: 100, right: 50, bottom: 300});
    expect(resizeFrame(tall, null)!.start).toMatchObject({resizes: 'y'});
    expect(resizeFrame(square, null)!.start).not.toHaveProperty('resizes');
  });

  it('a pending flat polygon keeps its flat axis collapsed onto the lasso centre', () => {
    const flat = polygon({left: 100, top: 200, right: 300, bottom: 200});
    const f = resizeFrame(flat, {left: 95, top: 190, right: 405, bottom: 214})!;
    expect(f.pending).toBe(true);
    expect(f.start).toEqual({kind: 'box', rect: {left: 100, top: 202, right: 400, bottom: 202}, resizes: 'x'});
  });

  it('a pending upright polygon keeps its zero width collapsed onto the lasso centre', () => {
    const tall = polygon({left: 50, top: 100, right: 50, bottom: 300});
    const f = resizeFrame(tall, {left: 40, top: 95, right: 64, bottom: 405})!;
    expect(f.start).toEqual({kind: 'box', rect: {left: 52, top: 100, right: 52, bottom: 400}, resizes: 'y'});
  });

  it('a line opens as a line edit on its first and last points', () => {
    const poly: Geometry = {...hLine, points: [{x: 0, y: 0}, {x: 5, y: 5}, {x: 10, y: 0}]};
    expect(resizeFrame(hLine, null)!.start).toEqual({kind: 'line', from: {x: 100, y: 500}, to: {x: 400, y: 500}});
    expect(resizeFrame(poly, null)!.start).toEqual({kind: 'line', from: {x: 0, y: 0}, to: {x: 10, y: 0}});
  });

  it('a pending line maps its endpoints stored → start (zero-height axis translated)', () => {
    const f = resizeFrame(hLine, {left: 50, top: 480, right: 450, bottom: 520})!;
    expect(f.pending).toBe(true);
    const start = f.start as Extract<ResizeEdit, {kind: 'line'}>;
    expect(start.from.x).toBeCloseTo(55, 6);
    expect(start.from.y).toBeCloseTo(500, 6);
    expect(start.to.x).toBeCloseTo(445, 6);
    expect(start.to.y).toBeCloseTo(500, 6);
  });
});

describe('hitTest', () => {
  const R: Rect = {left: 100, top: 100, right: 400, bottom: 300};
  const edit = box(R);

  it.each([
    ['nw', 100, 100], ['n', 250, 100], ['ne', 400, 100], ['e', 400, 200],
    ['se', 400, 300], ['s', 250, 300], ['sw', 100, 300], ['w', 100, 200],
  ])('finds %s at its handle point', (handle, x, y) => {
    expect(hitTest(edit, {x, y})).toBe(handle);
  });

  it('a corner grabs within the hit distance and loses to its edge just beyond it', () => {
    expect(hitTest(edit, {x: 140, y: 140})).toBe('nw');
    expect(hitTest(edit, {x: 141, y: 100})).toBe('n');
  });

  it('the corner wins over an edge at the corner', () => {
    expect(hitTest(edit, {x: 105, y: 102})).toBe('nw');
  });

  it('an edge grabs anywhere along the side, on either side of it', () => {
    expect(hitTest(edit, {x: 180, y: 95})).toBe('n');
    expect(hitTest(edit, {x: 395, y: 240})).toBe('e');
    expect(hitTest(edit, {x: 300, y: 330})).toBe('s');
  });

  it('on a thin box where two edges are in reach, the nearer wins', () => {
    const thin = box({left: 100, top: 100, right: 400, bottom: 115});
    expect(hitTest(thin, {x: 150, y: 105})).toBe('n');
    expect(hitTest(thin, {x: 150, y: 110})).toBe('s');
  });

  it('beyond the side\'s span is not the edge', () => {
    expect(hitTest(edit, {x: 50, y: 100})).toBeNull();
  });

  it('inside is move; outside is nothing', () => {
    expect(hitTest(edit, {x: 250, y: 200})).toBe('move');
    expect(hitTest(edit, {x: 170, y: 160})).toBe('move');
    expect(hitTest(edit, {x: 250, y: 360})).toBeNull();
    expect(hitTest(edit, {x: 250, y: 59})).toBeNull();
    expect(hitTest(edit, {x: 600, y: 600})).toBeNull();
  });

  it('a non-finite pen point hits nothing', () => {
    expect(hitTest(edit, {x: NaN, y: 200})).toBeNull();
  });

  it('on a tiny box the centre still moves it and a corner grows it', () => {
    const tiny = box({left: 100, top: 100, right: 120, bottom: 120});
    // t = 10 (floor tol/4), so the centre area is 5 px.
    expect(hitTest(tiny, {x: 110, y: 110})).toBe('move');
    expect(hitTest(tiny, {x: 114, y: 106})).toBe('move');
    expect(hitTest(tiny, {x: 104, y: 104})).toBe('nw');
    expect(hitTest(tiny, {x: 116, y: 118})).toBe('se');
  });

  it('where two corners are in reach, the nearer wins', () => {
    const small = box({left: 100, top: 100, right: 112, bottom: 112});
    expect(hitTest(small, {x: 103, y: 100})).toBe('nw');
    expect(hitTest(small, {x: 110, y: 100})).toBe('ne');
  });

  it('the centre rule wins over a corner that covers it', () => {
    // t = 10 reaches the centre from every corner of a 16 px box.
    expect(hitTest(box({left: 100, top: 100, right: 116, bottom: 116}), {x: 108, y: 108})).toBe('move');
  });

  it('on a small box the hit distance shrinks to a third of the shorter side', () => {
    const small = box({left: 100, top: 100, right: 160, bottom: 160});
    expect(hitTest(small, {x: 125, y: 125})).toBe('move');
    expect(hitTest(small, {x: 118, y: 118})).toBe('nw');
  });

  it('the shrunk hit distance never drops below a quarter of tol', () => {
    const tiny = box({left: 100, top: 100, right: 112, bottom: 112});
    expect(hitTest(tiny, {x: 100, y: 91})).toBe('nw');
    expect(hitTest(tiny, {x: 100, y: 89})).toBeNull();
  });

  it('a flat box offers only its end handles, plus move at the centre', () => {
    const flat: ResizeEdit = {kind: 'box', rect: {left: 100, top: 200, right: 300, bottom: 200}, resizes: 'x'};
    expect(hitTest(flat, {x: 100, y: 200})).toBe('w');
    expect(hitTest(flat, {x: 305, y: 204})).toBe('e');
    expect(hitTest(flat, {x: 200, y: 202})).toBe('move');
    expect(hitTest(flat, {x: 150, y: 200})).toBeNull();
    const upright: ResizeEdit = {kind: 'box', rect: {left: 50, top: 100, right: 50, bottom: 300}, resizes: 'y'};
    expect(hitTest(upright, {x: 50, y: 100})).toBe('n');
    expect(hitTest(upright, {x: 52, y: 296})).toBe('s');
  });

  it('honours a custom tol', () => {
    expect(hitTest(edit, {x: 250, y: 75}, 20)).toBeNull();
    expect(hitTest(edit, {x: 250, y: 75}, HANDLE_HIT_PX)).toBe('n');
  });

  describe('line', () => {
    const line: ResizeEdit = {kind: 'line', from: {x: 100, y: 100}, to: {x: 300, y: 100}};

    it('grabs the endpoint under the pen', () => {
      expect(hitTest(line, {x: 110, y: 90})).toBe('from');
      expect(hitTest(line, {x: 290, y: 130})).toBe('to');
    });

    it('both within reach: the nearer wins, a tie goes to `to`', () => {
      const short: ResizeEdit = {kind: 'line', from: {x: 100, y: 100}, to: {x: 130, y: 100}};
      expect(hitTest(short, {x: 105, y: 100})).toBe('from');
      expect(hitTest(short, {x: 125, y: 100})).toBe('to');
      expect(hitTest(short, {x: 115, y: 100})).toBe('to');
    });

    it('away from both endpoints hits nothing (a line has no move handle)', () => {
      expect(hitTest(line, {x: 200, y: 100})).toBeNull();
      expect(hitTest(line, {x: 200, y: 300})).toBeNull();
    });
  });
});

describe('dragHandle', () => {
  const R: Rect = {left: 100, top: 100, right: 400, bottom: 300};
  const edit = box(R);
  const drag = (handle: Parameters<typeof dragHandle>[1], x: number, y: number, from: ResizeEdit = edit) =>
    dragHandle(from, handle, {x, y}, PAGE);

  it.each([
    ['e', {left: 100, top: 100, right: 450, bottom: 300}],
    ['w', {left: 150, top: 100, right: 400, bottom: 300}],
    ['n', {left: 100, top: 130, right: 400, bottom: 300}],
    ['s', {left: 100, top: 100, right: 400, bottom: 330}],
    ['ne', {left: 100, top: 130, right: 450, bottom: 300}],
    ['nw', {left: 150, top: 130, right: 400, bottom: 300}],
    ['se', {left: 100, top: 100, right: 450, bottom: 330}],
    ['sw', {left: 150, top: 100, right: 400, bottom: 330}],
    ['move', {left: 150, top: 130, right: 450, bottom: 330}],
  ] as const)('%s by (50, 30): edges one axis, corners both, move translates', (handle, rect) => {
    expect(drag(handle, 50, 30)).toEqual(box(rect));
  });

  it('move stays on the page at every edge', () => {
    expect(drag('move', -500, 0)).toEqual(box({left: 0, top: 100, right: 300, bottom: 300}));
    expect(drag('move', 5000, 0)).toEqual(box({left: 1104, top: 100, right: 1404, bottom: 300}));
    expect(drag('move', 0, -500)).toEqual(box({left: 100, top: 0, right: 400, bottom: 200}));
    expect(drag('move', 0, 5000)).toEqual(box({left: 100, top: 1672, right: 400, bottom: 1872}));
  });

  it('a side stays on the page', () => {
    expect(drag('w', -500, 0)).toEqual(box({...R, left: 0}));
    expect(drag('e', 5000, 0)).toEqual(box({...R, right: 1404}));
    expect(drag('n', 0, -500)).toEqual(box({...R, top: 0}));
    expect(drag('s', 0, 5000)).toEqual(box({...R, bottom: 1872}));
  });

  it('a side stops minSide short of its opposite (no flip)', () => {
    expect(drag('e', -1000, 0)).toEqual(box({...R, right: 116}));
    expect(drag('w', 1000, 0)).toEqual(box({...R, left: 384}));
    expect(drag('n', 0, 1000)).toEqual(box({...R, top: 284}));
    expect(drag('s', 0, -1000)).toEqual(box({...R, bottom: 116}));
    expect(dragHandle(edit, 'e', {x: -1000, y: 0}, PAGE, 50)).toEqual(box({...R, right: 150}));
  });

  it('a box already narrower than minSide cannot shrink further, and does not jump', () => {
    const tiny = box({left: 100, top: 100, right: 110, bottom: 110});
    expect(drag('e', 0, 0, tiny)).toEqual(tiny);
    expect(drag('e', -5, 0, tiny)).toEqual(tiny);
    expect(drag('w', 3, 0, tiny)).toEqual(tiny);
    expect(drag('se', 40, 40, tiny)).toEqual(box({left: 100, top: 100, right: 150, bottom: 150}));
  });

  it('a start box partly off the page never jumps when grabbed', () => {
    const off = box({left: -5, top: 100, right: 200, bottom: 300});
    expect(drag('e', 10, 0, off)).toEqual(box({left: -5, top: 100, right: 210, bottom: 300}));
    expect(drag('w', 0, 0, off)).toEqual(off);
    expect(drag('w', -10, 0, off)).toEqual(off);
    expect(drag('move', 0, 0, off)).toEqual(off);
    expect(drag('move', -10, 0, off)).toEqual(off);
    expect(drag('move', 10, 0, off)).toEqual(box({left: 5, top: 100, right: 210, bottom: 300}));
  });

  it('is absolute from the snapshot: the same delta twice gives the same box', () => {
    expect(drag('e', 30, 0)).toEqual(drag('e', 30, 0));
    expect(drag('e', 30, 0)).toEqual(box({...R, right: 430}));
  });

  it('a non-finite delta returns the edit unchanged', () => {
    expect(drag('e', NaN, 0)).toBe(edit);
    expect(drag('e', 0, Infinity)).toBe(edit);
  });

  it('a flat box ignores handles that would give it height, and keeps its restriction', () => {
    const flat: ResizeEdit = {kind: 'box', rect: {left: 100, top: 200, right: 300, bottom: 200}, resizes: 'x'};
    expect(drag('se', 40, 40, flat)).toBe(flat);
    expect(drag('n', 0, -40, flat)).toBe(flat);
    expect(drag('e', 40, 40, flat)).toEqual({...flat, rect: {left: 100, top: 200, right: 340, bottom: 200}});
    expect(drag('move', 10, 10, flat)).toEqual({...flat, rect: {left: 110, top: 210, right: 310, bottom: 210}});
  });

  describe('line', () => {
    const line: ResizeEdit = {kind: 'line', from: {x: 100, y: 100}, to: {x: 300, y: 100}};

    it('an endpoint stops minSide short of the other endpoint', () => {
      expect(drag('to', -200, 0, line)).toEqual({...line, to: {x: 116, y: 100}});
      expect(drag('to', -190, 0, line)).toEqual({...line, to: {x: 116, y: 100}});
      expect(drag('from', 195, 0, line)).toEqual({...line, from: {x: 284, y: 100}});
      // Dragged past the other endpoint: it stays on the side it moved to.
      expect(drag('to', -210, 0, line)).toEqual({...line, to: {x: 84, y: 100}});
    });

    it('an endpoint that starts on the other one is pushed out along +x', () => {
      const dot: ResizeEdit = {kind: 'line', from: {x: 100, y: 100}, to: {x: 100, y: 100}};
      expect(drag('to', 0, 0, dot)).toEqual({...dot, to: {x: 116, y: 100}});
    });

    it('drags one endpoint freely', () => {
      expect(drag('to', 50, 20, line)).toEqual({...line, to: {x: 350, y: 120}});
      expect(drag('from', -20, 40, line)).toEqual({...line, from: {x: 80, y: 140}});
    });

    it('an endpoint stays on the page, and one already off it does not jump', () => {
      expect(drag('from', -500, 5000, line)).toEqual({...line, from: {x: 0, y: 1872}});
      const off: ResizeEdit = {kind: 'line', from: {x: -3, y: 100}, to: {x: 300, y: 100}};
      expect(drag('from', 0, 0, off)).toEqual(off);
    });
  });

  it('a handle that does not fit the edit kind returns it unchanged', () => {
    const line: ResizeEdit = {kind: 'line', from: {x: 100, y: 100}, to: {x: 300, y: 100}};
    expect(drag('to', 10, 10)).toBe(edit);
    expect(drag('e', 10, 10, line)).toBe(line);
    expect(drag('move', 10, 10, line)).toBe(line);
  });
});

describe('boxHandles', () => {
  const rect = {left: 0, top: 0, right: 10, bottom: 10};

  it('offers all eight side handles, or one axis for a flat shape', () => {
    expect(boxHandles({kind: 'box', rect})).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
    expect(boxHandles({kind: 'box', rect, resizes: 'x'})).toEqual(['e', 'w']);
    expect(boxHandles({kind: 'box', rect, resizes: 'y'})).toEqual(['n', 's']);
  });
});

describe('editsEqual', () => {
  const R: Rect = {left: 100, top: 100, right: 400, bottom: 300};
  const line: ResizeEdit = {kind: 'line', from: {x: 1, y: 2}, to: {x: 3, y: 4}};

  it('boxes: equal within 0.5 px, different beyond', () => {
    expect(editsEqual(box(R), box({...R}))).toBe(true);
    expect(editsEqual(box(R), box({...R, right: 400.5}))).toBe(true);
    expect(editsEqual(box(R), box({...R, bottom: 300.6}))).toBe(false);
  });

  it('lines: equal within 0.5 px, different beyond', () => {
    expect(editsEqual(line, {...line, to: {x: 3.4, y: 4}})).toBe(true);
    expect(editsEqual(line, {...line, from: {x: 1, y: 2.6}})).toBe(false);
  });

  it('different kinds are never equal', () => {
    expect(editsEqual(box(R), line)).toBe(false);
    expect(editsEqual(line, box(R))).toBe(false);
  });

  it('honours a custom eps', () => {
    expect(editsEqual(box(R), box({...R, left: 102}), 2)).toBe(true);
  });
});

describe('applyResize', () => {
  it('maps a polygon exactly onto the edited box', () => {
    const rect: Rect = {left: 50, top: 60, right: 450, bottom: 160};
    expectRectClose(geometryNaturalBounds(applyResize(square, box(rect))!), rect);
  });

  it('bakes a pending native resize: stored → edited even when the handles opened elsewhere', () => {
    const f = resizeFrame(square, {left: 92, top: 92, right: 508, bottom: 208})!;
    const edited = dragHandle(f.start, 'e', {x: 40, y: 0}, PAGE);
    const out = applyResize(square, edited)!;
    expectRectClose(geometryNaturalBounds(out), (edited as Extract<ResizeEdit, {kind: 'box'}>).rect);
  });

  it('scales an ellipse per axis', () => {
    const ellipse: Geometry = {...circle, type: 'GEO_ellipse', ellipseMajorAxisRadius: 120, ellipseMinorAxisRadius: 60};
    const out = applyResize(ellipse, box({left: 0, top: 0, right: 480, bottom: 60}))!;
    expect(out.type).toBe('GEO_ellipse');
    expect(out.ellipseMajorAxisRadius).toBeCloseTo(240, 6);
    expect(out.ellipseMinorAxisRadius).toBeCloseTo(30, 6);
    expect(out.ellipseCenterPoint).toEqual({x: 240, y: 30});
  });

  it('a 45° ellipse is approximated — centre on the box centre, type and angle kept', () => {
    const rotated: Geometry = {
      ...circle, type: 'GEO_ellipse', ellipseMajorAxisRadius: 120, ellipseMinorAxisRadius: 60, ellipseAngle: 45,
    };
    const out = applyResize(rotated, box({left: 100, top: 200, right: 700, bottom: 400}))!;
    expect(out.type).toBe('GEO_ellipse');
    expect(out.ellipseAngle).toBe(45);
    expect(out.ellipseCenterPoint!.x).toBeCloseTo(400, 6);
    expect(out.ellipseCenterPoint!.y).toBeCloseTo(300, 6);
    // At 45° both radii get the mean of the two axis scales, so the AABB
    // is close to, not exactly, the box.
    const natural = geometryNaturalBounds(rotated)!;
    const sx = 600 / (natural.right - natural.left);
    const sy = 200 / (natural.bottom - natural.top);
    expect(out.ellipseMajorAxisRadius).toBeCloseTo(120 * (sx + sy) / 2, 6);
    expect(out.ellipseMinorAxisRadius).toBeCloseTo(60 * (sx + sy) / 2, 6);
  });

  it('an unevenly stretched circle becomes an ellipse', () => {
    const out = applyResize(circle, box({left: 0, top: 0, right: 400, bottom: 100}))!;
    expect(out.type).toBe('GEO_ellipse');
    expect(out.ellipseMajorAxisRadius).toBeCloseTo(200, 6);
    expect(out.ellipseMinorAxisRadius).toBeCloseTo(50, 6);
  });

  it('a uniformly stretched circle stays a circle', () => {
    const out = applyResize(circle, box({left: 0, top: 0, right: 300, bottom: 300}))!;
    expect(out.type).toBe('GEO_circle');
    expect(out.ellipseMajorAxisRadius).toBeCloseTo(150, 6);
  });

  it('sub-epsilon float noise does not flip a circle to an ellipse', () => {
    const out = applyResize(circle, box({left: 0, top: 0, right: 1000, bottom: 1000 + 1e-7}))!;
    expect(out.ellipseMajorAxisRadius).not.toBe(out.ellipseMinorAxisRadius);
    expect(out.type).toBe('GEO_circle');
  });

  it('preserves pen props and unknown extras, and never mutates the input', () => {
    const g: Geometry = {...square, extra: 'kept'};
    const snapshot = JSON.stringify(g);
    const out = applyResize(g, box({left: 0, top: 0, right: 10, bottom: 20}))!;
    expect(out).toMatchObject({...pen, extra: 'kept', type: 'GEO_polygon'});
    expect(JSON.stringify(g)).toBe(snapshot);
  });

  it('a single degenerate axis is still resized (translated on that axis)', () => {
    const flat: Geometry = {type: 'GEO_polygon', ...pen, points: [{x: 0, y: 5}, {x: 100, y: 5}]};
    const out = applyResize(flat, box({left: 0, top: 0, right: 200, bottom: 100}))!;
    expectRectClose(geometryNaturalBounds(out), {left: 0, top: 50, right: 200, bottom: 50});
  });

  it('a box squashed to zero on an axis the shape has → null; a flat axis may stay flat', () => {
    expect(applyResize(square, box({left: 100, top: 100, right: 100, bottom: 200}))).toBeNull();
    expect(applyResize(square, box({left: 100, top: 150, right: 300, bottom: 150}))).toBeNull();
    const flat = polygon({left: 100, top: 200, right: 300, bottom: 200});
    const out = applyResize(flat, {kind: 'box', rect: {left: 100, top: 200, right: 500, bottom: 200}, resizes: 'x'})!;
    expectRectClose(geometryNaturalBounds(out), {left: 100, top: 200, right: 500, bottom: 200});
  });

  it('a line edit writes the two endpoints, keeping the pen', () => {
    const line = SHAPES.find(s => s.id === 'line')!;
    const params = Object.fromEntries(line.parameters.map(p => [p.id, p.defaultValue]));
    const g = line.build({x: 700, y: 900}, params, PEN_DEFAULTS) as Geometry;
    const out = applyResize(g, {kind: 'line', from: {x: 100, y: 500}, to: {x: 400, y: 200}})!;
    expect(out.points).toEqual([{x: 100, y: 500}, {x: 400, y: 200}]);
    expect(out.penWidth).toBe(g.penWidth);
  });

  it.each([
    ['endpoints under 1 px apart', {kind: 'line', from: {x: 5, y: 5}, to: {x: 5.5, y: 5.5}}],
    ['a non-finite endpoint', {kind: 'line', from: {x: NaN, y: 5}, to: {x: 50, y: 5}}],
  ])('a line edit with %s → null', (_label, edit) => {
    expect(applyResize(hLine, edit as ResizeEdit)).toBeNull();
  });

  it('a mismatched edit kind → null', () => {
    expect(applyResize(hLine, box({left: 0, top: 0, right: 100, bottom: 100}))).toBeNull();
    expect(applyResize(square, {kind: 'line', from: {x: 0, y: 0}, to: {x: 50, y: 50}})).toBeNull();
  });

  it.each([
    ['non-finite', {left: 0, top: 0, right: NaN, bottom: 10}],
    ['inverted horizontally', {left: 10, top: 0, right: 0, bottom: 10}],
    ['inverted vertically', {left: 0, top: 10, right: 10, bottom: 0}],
  ])('a %s box → null', (_label, rect) => {
    expect(applyResize(square, box(rect as Rect))).toBeNull();
  });

  it.each([
    ['an unknown type', {type: 'GEO_mystery', ...pen} as Geometry],
    ['a malformed ellipse', {type: 'GEO_ellipse', ...pen} as Geometry],
    ['every point coincident', polygon({left: 5, top: 5, right: 5, bottom: 5})],
    ['a non-finite point', polygon({left: 0, top: 0, right: NaN, bottom: 10})],
  ])('%s → null', (_label, g) => {
    expect(applyResize(g, box({left: 0, top: 0, right: 10, bottom: 10}))).toBeNull();
  });
});
