/**
 * Resize handles — the pure model behind Edit Shape's free resize (#17).
 * See docs/adr/ADR-FREE-RESIZE.md.
 *
 * The user drags handles on a lassoed shape's current box: corners stretch
 * both axes freely, edges one axis, the inside moves the box; a line gets
 * two endpoint handles instead. Nothing here knows about React Native or
 * the SDK: `ResizeHandlesOverlay` feeds it page-px pen positions and the
 * Edit Shape panel writes the result with `modifyLassoGeometry`.
 *
 * The one subtle rule is where the handles start. `getLassoGeometries()`
 * returns the shape's *stored* coordinates, while `getLassoRect()` is the
 * *visual* box: stored bounds plus stroke padding, plus any native lasso
 * resize or move still pending in this lasso session. The handles open on
 * the stored bounds unless the lasso rect's size or centre is further off
 * than padding can explain (`lassoShowsPendingEdit`); then they open on the
 * lasso rect inset by half the padding bound. The write is always
 * stored → edited box, and axis-aligned remaps compose, so a pending native
 * edit is baked in. An unchanged Done writes nothing, so it is exact. After
 * a native resize or move, though, the start box is an estimate, and a Done
 * that moves only some sides may shift the untouched ones by the estimate
 * error (at most about `tol / 2` minus the real padding, e.g. ~5 px at pen
 * width 900).
 */
import {
  applyRectTransform,
  clamp,
  defaultLassoTolerance,
  EPSILON,
  geometryNaturalBounds,
  Geometry,
  isFiniteRect,
  Point,
  Rect,
} from './lassoTransform';
import {MIN_DRAG_SIDE_PX, PageSize} from './placement';

/** Page px. A pen this close to a handle (Chebyshev) grabs it; shrinks on
 *  small boxes so the move area stays reachable, see `hitTest`. */
export const HANDLE_HIT_PX = 40;

export type BoxHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';
export type LineHandle = 'from' | 'to';
export type Handle = BoxHandle | LineHandle;

/**
 * What the user is editing, in page px. `resizes` restricts a box to one
 * axis when the stored shape has no extent on the other (a flat polygon):
 * handles that would give it one are not offered.
 */
export type ResizeEdit =
  | {kind: 'box'; rect: Rect; resizes?: 'x' | 'y'}
  | {kind: 'line'; from: Point; to: Point};

type BoxEdit = Extract<ResizeEdit, {kind: 'box'}>;

/**
 * `stored` = the geometry's natural bounds; `start` = the edit the handles
 * open on; `pending` = the lasso rect showed a native resize not yet in the
 * stored coordinates (logged as the device probe for the start box).
 */
export type ResizeFrame = {stored: Rect; start: ResizeEdit; pending: boolean};

const CORNERS: ReadonlyArray<{handle: BoxHandle; x: 'left' | 'right'; y: 'top' | 'bottom'}> = [
  {handle: 'nw', x: 'left', y: 'top'},
  {handle: 'ne', x: 'right', y: 'top'},
  {handle: 'se', x: 'right', y: 'bottom'},
  {handle: 'sw', x: 'left', y: 'bottom'},
];

const ALL_SIDE_HANDLES: ReadonlyArray<BoxHandle> = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const X_ONLY: ReadonlyArray<BoxHandle> = ['e', 'w'];
const Y_ONLY: ReadonlyArray<BoxHandle> = ['n', 's'];

const LEFT_SIDE: ReadonlySet<Handle> = new Set(['nw', 'w', 'sw']);
const RIGHT_SIDE: ReadonlySet<Handle> = new Set(['ne', 'e', 'se']);
const TOP_SIDE: ReadonlySet<Handle> = new Set(['nw', 'n', 'ne']);
const BOTTOM_SIDE: ReadonlySet<Handle> = new Set(['sw', 's', 'se']);

function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function width(r: Rect): number {
  return r.right - r.left;
}

function height(r: Rect): number {
  return r.bottom - r.top;
}

function isUsableRect(r: Rect | null): r is Rect {
  return r !== null && isFiniteRect(r) && r.right >= r.left && r.bottom >= r.top;
}

/**
 * The stored natural bounds of `g` when it can be resized, else null:
 * unknown type, malformed or non-finite coordinates, or every point
 * coincident (both axes degenerate — nothing to stretch).
 */
function resizableBounds(g: Geometry): Rect | null {
  const pts = g.points;
  if (Array.isArray(pts) && !pts.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) {
    return null;
  }
  const r = geometryNaturalBounds(g);
  if (!r || !isFiniteRect(r)) {return null;}
  return width(r) < EPSILON && height(r) < EPSILON ? null : r;
}

/**
 * True when the lasso rect shows a native resize or move not yet in the
 * stored coordinates, rather than just stroke padding. Padding grows every
 * side by roughly the same amount — up to about `tol` on sharp vertices
 * (a star, a thin triangle) — so it changes the size by at most `2·tol`
 * and leaves the centre in place. A larger size change, or a centre moved
 * by more than `tol`, is the user's doing.
 */
function lassoShowsPendingEdit(stored: Rect, lasso: Rect, tol: number): boolean {
  const dCx = (lasso.left + lasso.right - stored.left - stored.right) / 2;
  const dCy = (lasso.top + lasso.bottom - stored.top - stored.bottom) / 2;
  return (
    Math.abs(width(lasso) - width(stored)) > 2 * tol ||
    Math.abs(height(lasso) - height(stored)) > 2 * tol ||
    Math.abs(dCx) > tol ||
    Math.abs(dCy) > tol
  );
}

/** The side handles a box edit offers (see `ResizeEdit.resizes`). */
export function boxHandles(edit: BoxEdit): ReadonlyArray<BoxHandle> {
  if (edit.resizes === 'x') {return X_ONLY;}
  if (edit.resizes === 'y') {return Y_ONLY;}
  return ALL_SIDE_HANDLES;
}

/**
 * Where the handles open for `g`, given the current lasso rect (null when
 * the read failed). Returns null when the shape cannot be resized: unknown
 * type, malformed geometry, or every point coincides.
 */
export function resizeFrame(g: Geometry, lassoRect: Rect | null): ResizeFrame | null {
  const stored = resizableBounds(g);
  if (!stored) {return null;}
  const tol = defaultLassoTolerance(g.penWidth);
  const pending = isUsableRect(lassoRect) && lassoShowsPendingEdit(stored, lassoRect, tol);
  const flatX = width(stored) < EPSILON;
  const flatY = height(stored) < EPSILON;
  let startRect = stored;
  if (pending) {
    const pad = Math.min(tol / 2, width(lassoRect) / 4, height(lassoRect) / 4);
    const cx = (lassoRect.left + lassoRect.right) / 2;
    const cy = (lassoRect.top + lassoRect.bottom) / 2;
    // A flat axis stays flat: collapse it onto the lasso rect's centre.
    startRect = {
      left: flatX ? cx : lassoRect.left + pad,
      top: flatY ? cy : lassoRect.top + pad,
      right: flatX ? cx : lassoRect.right - pad,
      bottom: flatY ? cy : lassoRect.bottom - pad,
    };
  }
  if (g.type === 'straightLine') {
    // geometryNaturalBounds resolved, so `points` is a non-empty array.
    const pts = (pending ? applyRectTransform(g, stored, startRect) : g).points as Point[];
    const first = pts[0];
    const last = pts[pts.length - 1];
    return {
      stored,
      start: {kind: 'line', from: {x: first.x, y: first.y}, to: {x: last.x, y: last.y}},
      pending,
    };
  }
  const start: BoxEdit = {kind: 'box', rect: startRect};
  if (flatY) {start.resizes = 'x';}
  if (flatX) {start.resizes = 'y';}
  return {stored, start, pending};
}

/**
 * The handle under the pen at `p` (page px), or null. Box priority is
 * centre (move) → corner → edge → inside (move): the hit distance `t`
 * shrinks to a third of the shorter side (never below `tol / 4`). The
 * centre rule (within `t / 2`) keeps a tiny box movable even where its
 * corners cover the inside; the user grows it by a corner. Only the
 * handles `boxHandles` offers are hit. A line's endpoints use the full
 * `tol`; the nearer wins, a tie goes to `to`.
 */
export function hitTest(edit: ResizeEdit, p: Point, tol = HANDLE_HIT_PX): Handle | null {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {return null;}
  if (edit.kind === 'line') {
    const dFrom = chebyshev(p, edit.from);
    const dTo = chebyshev(p, edit.to);
    if (dTo <= tol && dTo <= dFrom) {return 'to';}
    if (dFrom <= tol) {return 'from';}
    return null;
  }
  const r = edit.rect;
  const t = clamp(Math.min(width(r), height(r)) / 3, tol / 4, tol);
  const centre = {x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2};
  if (chebyshev(p, centre) <= t / 2) {return 'move';}
  const offered = boxHandles(edit);
  let best: {handle: BoxHandle; d: number} | null = null;
  for (const c of CORNERS) {
    if (!offered.includes(c.handle)) {continue;}
    const d = chebyshev(p, {x: r[c.x], y: r[c.y]});
    if (d <= t && (!best || d < best.d)) {best = {handle: c.handle, d};}
  }
  if (best) {return best.handle;}
  // An edge reaches `t` past its ends too, so a flat box's end handles
  // (whose side has no length) can still be grabbed.
  const withinX = p.x >= r.left - t && p.x <= r.right + t;
  const withinY = p.y >= r.top - t && p.y <= r.bottom + t;
  const edges: Array<{handle: BoxHandle; d: number; along: boolean}> = [
    {handle: 'n', d: Math.abs(p.y - r.top), along: withinX},
    {handle: 'e', d: Math.abs(p.x - r.right), along: withinY},
    {handle: 's', d: Math.abs(p.y - r.bottom), along: withinX},
    {handle: 'w', d: Math.abs(p.x - r.left), along: withinY},
  ];
  for (const e of edges) {
    if (!offered.includes(e.handle) || !e.along || e.d > t) {continue;}
    if (!best || e.d < best.d) {best = {handle: e.handle, d: e.d};}
  }
  if (best) {return best.handle;}
  if (p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom) {return 'move';}
  return null;
}

/**
 * The edit after dragging `handle` by `delta` (pen-now minus pen-down, page
 * px). Absolute from the pen-down snapshot `from`, never incremental, so a
 * throttled or skipped move event cannot make the box drift.
 *
 * A side stops `minSide` short of its opposite (no flipping) and stays on
 * the page; a box already narrower than `minSide` cannot shrink further. A
 * line endpoint stops `minSide` from the other endpoint. The page bounds
 * widen to include the start position, so a start box that sits partly
 * off-page (lasso padding at a page edge) never jumps when grabbed. A
 * handle that does not fit the edit kind or is not offered (`boxHandles`),
 * or a non-finite delta, returns `from` unchanged.
 */
export function dragHandle(
  from: ResizeEdit,
  handle: Handle,
  delta: Point,
  page: PageSize,
  minSide = MIN_DRAG_SIDE_PX,
): ResizeEdit {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {return from;}
  if (from.kind === 'line') {
    if (handle !== 'from' && handle !== 'to') {return from;}
    const q = from[handle];
    const other = handle === 'from' ? from.to : from.from;
    let moved = {
      x: clamp(q.x + delta.x, Math.min(0, q.x), Math.max(page.width, q.x)),
      y: clamp(q.y + delta.y, Math.min(0, q.y), Math.max(page.height, q.y)),
    };
    moved = keepApart(moved, q, other, minSide);
    return {...from, [handle]: moved};
  }
  if (handle === 'from' || handle === 'to') {return from;}
  const r = from.rect;
  if (handle === 'move') {
    const dx = clamp(delta.x, Math.min(0, -r.left), Math.max(0, page.width - r.right));
    const dy = clamp(delta.y, Math.min(0, -r.top), Math.max(0, page.height - r.bottom));
    return {
      ...from,
      rect: {left: r.left + dx, top: r.top + dy, right: r.right + dx, bottom: r.bottom + dy},
    };
  }
  if (!boxHandles(from).includes(handle)) {return from;}
  const next = {...r};
  if (LEFT_SIDE.has(handle)) {
    next.left = clamp(r.left + delta.x, Math.min(0, r.left), Math.max(r.right - minSide, r.left));
  } else if (RIGHT_SIDE.has(handle)) {
    next.right = clamp(r.right + delta.x, Math.min(r.left + minSide, r.right), Math.max(page.width, r.right));
  }
  if (TOP_SIDE.has(handle)) {
    next.top = clamp(r.top + delta.y, Math.min(0, r.top), Math.max(r.bottom - minSide, r.top));
  } else if (BOTTOM_SIDE.has(handle)) {
    next.bottom = clamp(r.bottom + delta.y, Math.min(r.top + minSide, r.bottom), Math.max(page.height, r.bottom));
  }
  return {...from, rect: next};
}

/**
 * `p` pushed out to `minSide` from `anchor` along the anchor → p direction
 * (anchor → `fallback`, then +x, when p sits on the anchor), so a dragged
 * line endpoint never collapses onto the other one.
 */
function keepApart(p: Point, fallback: Point, anchor: Point, minSide: number): Point {
  const d = Math.hypot(p.x - anchor.x, p.y - anchor.y);
  if (d >= minSide) {return p;}
  let ux = p.x - anchor.x;
  let uy = p.y - anchor.y;
  if (d < EPSILON) {
    ux = fallback.x - anchor.x;
    uy = fallback.y - anchor.y;
  }
  const len = Math.hypot(ux, uy);
  if (len < EPSILON) {
    ux = 1;
    uy = 0;
  } else {
    ux /= len;
    uy /= len;
  }
  return {x: anchor.x + ux * minSide, y: anchor.y + uy * minSide};
}

/** Width and height, in whatever unit the caller works in. */
export type Size = {width: number; height: number};

/**
 * Where the floating Cancel / Done toolbar goes for a shape whose drawn
 * bounds are `bounds` (all in dp): centred under the shape, `gap` below it;
 * above it with the same gap when there is no room below; inside the box
 * at its top (still `gap` in, clear of the top handles) when neither side
 * has room. Always clamped to stay fully on screen. `gap` should exceed the
 * handles' hit distance so the toolbar never covers one.
 */
export function toolbarPlacement(
  bounds: Rect,
  size: Size,
  screen: Size,
  gap: number,
): {left: number; top: number} {
  const left = clamp(
    (bounds.left + bounds.right) / 2 - size.width / 2,
    0,
    Math.max(0, screen.width - size.width),
  );
  const below = bounds.bottom + gap;
  if (below + size.height <= screen.height) {return {left, top: below};}
  const above = bounds.top - gap - size.height;
  if (above >= 0) {return {left, top: above};}
  return {left, top: clamp(bounds.top + gap, 0, Math.max(0, screen.height - size.height))};
}

/** Same kind and every coordinate within `eps` page px. */
export function editsEqual(a: ResizeEdit, b: ResizeEdit, eps = 0.5): boolean {
  const near = (u: number, v: number) => Math.abs(u - v) <= eps;
  if (a.kind === 'line' && b.kind === 'line') {
    return near(a.from.x, b.from.x) && near(a.from.y, b.from.y) &&
      near(a.to.x, b.to.x) && near(a.to.y, b.to.y);
  }
  if (a.kind === 'box' && b.kind === 'box') {
    return near(a.rect.left, b.rect.left) && near(a.rect.top, b.rect.top) &&
      near(a.rect.right, b.rect.right) && near(a.rect.bottom, b.rect.bottom);
  }
  return false;
}

/**
 * The geometry to write for the final `edit`, or null when it cannot be
 * resized. A box edit remaps the stored natural bounds exactly onto the
 * edited box; a circle stretched unevenly becomes a `GEO_ellipse` (same
 * fields; the relative tolerance keeps float noise on large radii from
 * flipping the type) and a rotated ellipse is approximated (see
 * `applyRectTransform`). A line edit writes the two endpoints. Pen props
 * and every other non-coordinate field are preserved; the input is never
 * mutated.
 *
 * The source box is recomputed from `g` rather than passed in, so the
 * write is stored → edited by construction.
 */
export function applyResize(g: Geometry, edit: ResizeEdit): Geometry | null {
  if (edit.kind === 'line') {
    if (g.type !== 'straightLine') {return null;}
    const {from, to} = edit;
    if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) {return null;}
    if (Math.hypot(to.x - from.x, to.y - from.y) < 1) {return null;}
    return {...g, points: [{x: from.x, y: from.y}, {x: to.x, y: to.y}]};
  }
  if (g.type === 'straightLine' || !isUsableRect(edit.rect)) {return null;}
  const stored = resizableBounds(g);
  if (!stored) {return null;}
  // An axis the shape has cannot be squashed to nothing.
  if (width(stored) >= EPSILON && width(edit.rect) < EPSILON) {return null;}
  if (height(stored) >= EPSILON && height(edit.rect) < EPSILON) {return null;}
  const out = applyRectTransform(g, stored, edit.rect);
  if (out.type !== 'GEO_circle') {return out;}
  const major = out.ellipseMajorAxisRadius as number;
  const minor = out.ellipseMinorAxisRadius as number;
  const uneven = Math.abs(major - minor) > EPSILON * Math.max(major, minor);
  return uneven ? {...out, type: 'GEO_ellipse'} : out;
}
