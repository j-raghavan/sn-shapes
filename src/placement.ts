/**
 * Placement — turns a pen gesture on the Shapes overlay into where (and how
 * big) a shape lands on the page. See docs/adr/ADR-PEN-PLACEMENT.md.
 *
 * Why this exists: issue #15 asked for shapes to appear under the pen tip
 * rather than at page centre, and observed that stroke width drifts when a
 * shape is resized with the native lasso afterwards (the firmware scales
 * stroke width along with the geometry). Both are solved at insert time:
 * a tap places the default-size shape under the pen; a drag fits the shape
 * into the swept box so no post-insert resize is needed.
 *
 * Pure module — no React Native or SDK imports — so every rule here is
 * host-testable. The only device-specific input is the dp→px `scale`
 * passed to `touchToPage`.
 */
import {
  applyRectTransform,
  geometryNaturalBounds,
  Geometry,
  Point,
  Rect,
} from './lassoTransform';

/** Page px. Pen-up closer than this to pen-down is a tap, not a drag. */
export const DRAG_THRESHOLD_PX = 16;
/** Page px. Each drag-rect side is floored here so a purely horizontal
 *  drag (or a shaky diagonal one) never yields a zero-area target. */
export const MIN_DRAG_SIDE_PX = 16;

export type PageSize = {width: number; height: number};

export type PlacementTarget =
  | {kind: 'tap'; point: Point}
  | {kind: 'drag'; rect: Rect};

export type PlacementOptions = {threshold?: number; minSide?: number};

/**
 * dp → page px. `sn-plugin-lib` documents geometry points as Android screen
 * coordinates, and RN's `pageX/pageY` are those px divided by density, so
 * the inverse is a single multiply. A nonsensical scale falls back to 1
 * rather than producing NaN geometry.
 */
export function touchToPage(p: Point, scale: number): Point {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {x: p.x * s, y: p.y * s};
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function clampPoint(p: Point, page: PageSize): Point {
  return {x: clamp(p.x, 0, page.width), y: clamp(p.y, 0, page.height)};
}

/**
 * Expand a 1-D span to at least `minSide` around its midpoint, then shift
 * it inward (never truncate) so it stays within [0, limit]. Shifting keeps
 * the guaranteed minimum size even for a drag that ends on a page edge.
 */
function ensureSpan(lo: number, hi: number, minSide: number, limit: number): [number, number] {
  let a = lo;
  let b = hi;
  if (b - a < minSide) {
    const mid = (a + b) / 2;
    a = mid - minSide / 2;
    b = mid + minSide / 2;
  }
  if (a < 0) {
    b -= a;
    a = 0;
  }
  if (b > limit) {
    a -= b - limit;
    b = limit;
  }
  return [Math.max(a, 0), b];
}

/**
 * The one tap-vs-drag rule (page px), shared by the release handler
 * that classifies the gesture and the move handler that decides when
 * the rubber band appears — so the two can never disagree.
 */
export function isDragGesture(down: Point, up: Point, threshold = DRAG_THRESHOLD_PX): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) >= threshold;
}

/**
 * Classify a pen-down / pen-up pair (page px) as a tap or a drag and
 * normalise the result onto the page.
 */
export function resolvePlacementTarget(
  down: Point,
  up: Point,
  page: PageSize,
  opts: PlacementOptions = {},
): PlacementTarget {
  const threshold = opts.threshold ?? DRAG_THRESHOLD_PX;
  const minSide = opts.minSide ?? MIN_DRAG_SIDE_PX;
  if (!isDragGesture(down, up, threshold)) {
    return {kind: 'tap', point: clampPoint(down, page)};
  }
  const a = clampPoint(down, page);
  const b = clampPoint(up, page);
  const [left, right] = ensureSpan(
    Math.min(a.x, b.x), Math.max(a.x, b.x), minSide, page.width,
  );
  const [top, bottom] = ensureSpan(
    Math.min(a.y, b.y), Math.max(a.y, b.y), minSide, page.height,
  );
  return {kind: 'drag', rect: {left, top, right, bottom}};
}

/** Shift `natural` so it lies within the page; origin-aligned if larger. */
function translateInsidePage(natural: Rect, centre: Point, page: PageSize): Rect {
  const w = natural.right - natural.left;
  const h = natural.bottom - natural.top;
  const left = clamp(centre.x - w / 2, 0, Math.max(0, page.width - w));
  const top = clamp(centre.y - h / 2, 0, Math.max(0, page.height - h));
  return {left, top, right: left + w, bottom: top + h};
}

/**
 * Translate (tap) or fit (drag) a built geometry to the target. Circles
 * scale uniformly to the shorter side so they stay circles; every other
 * type scales per axis, matching what the native lasso handle does.
 * Returns the input unchanged when its bounds cannot be determined.
 *
 * Generic in the geometry type: only coordinates change, the type and
 * every non-coordinate field are preserved, so the caller's richer
 * geometry type (e.g. the SDK one with `showLassoAfterInsert`) survives.
 * That is the one cast in this module.
 */
export function placeGeometry<G extends Geometry>(g: G, target: PlacementTarget, page: PageSize): G {
  const natural = geometryNaturalBounds(g);
  if (!natural) {return g;}
  if (target.kind === 'tap') {
    return applyRectTransform(g, natural, translateInsidePage(natural, target.point, page)) as G;
  }
  const {rect} = target;
  if (g.type === 'GEO_circle') {
    const r = Math.min(rect.right - rect.left, rect.bottom - rect.top) / 2;
    return {
      ...g,
      ellipseCenterPoint: {
        x: (rect.left + rect.right) / 2,
        y: (rect.top + rect.bottom) / 2,
      },
      ellipseMajorAxisRadius: r,
      ellipseMinorAxisRadius: r,
    };
  }
  return applyRectTransform(g, natural, rect) as G;
}
