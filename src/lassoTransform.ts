/**
 * Lasso-transform utilities.
 *
 * Why this exists: when the user resizes a lassoed shape with the native
 * lasso handle, the firmware keeps the resize as a pending transform on the
 * *lasso selection*, not as a mutation of the geometry's own coordinates.
 * `PluginCommAPI.getLassoGeometries()` returns the geometry's *stored*
 * coordinates (pre-resize); `PluginCommAPI.getLassoRect()` returns the
 * current *visual* bounds (post-resize).
 *
 * If we call `modifyLassoGeometry(g)` with the stored (pre-resize) geometry
 * plus our pen-style patch, the firmware treats our `g` as the new truth
 * and discards the pending visual transform. Result: the shape snaps back
 * to its insert-time size every time the user tweaks width/color. That's
 * exactly the friction the Reddit reviewer flagged.
 *
 * The fix is to bake the lasso-rect delta into the geometry's own
 * coordinates *before* sending modify. This module is the pure-function
 * side of that: no RN / SDK imports, so it's trivially unit-testable.
 */

export type Point = {x: number; y: number};

export type Rect = {left: number; top: number; right: number; bottom: number};

export type Geometry = {
  type: string;
  penColor: number;
  penType: number;
  penWidth: number;
  points?: Point[];
  ellipseCenterPoint?: Point;
  ellipseMajorAxisRadius?: number;
  ellipseMinorAxisRadius?: number;
  ellipseAngle?: number;
  [extra: string]: unknown;
};

const DEG = Math.PI / 180;
const EPSILON = 1e-6;

/**
 * Axis-aligned bounding box of a geometry's own stored coordinates.
 * Returns null for unknown / malformed geometries so callers can skip baking.
 */
export function geometryNaturalBounds(g: Geometry): Rect | null {
  switch (g.type) {
    case 'GEO_circle':
    case 'GEO_ellipse': {
      const c = g.ellipseCenterPoint;
      const rMaj = g.ellipseMajorAxisRadius;
      const rMin = g.ellipseMinorAxisRadius;
      const angle = g.ellipseAngle ?? 0;
      if (!c || typeof rMaj !== 'number' || typeof rMin !== 'number') {
        return null;
      }
      const theta = angle * DEG;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      // AABB half-width / half-height of a rotated ellipse centred at origin.
      const halfW = Math.sqrt((rMaj * cosT) ** 2 + (rMin * sinT) ** 2);
      const halfH = Math.sqrt((rMaj * sinT) ** 2 + (rMin * cosT) ** 2);
      return {
        left: c.x - halfW,
        right: c.x + halfW,
        top: c.y - halfH,
        bottom: c.y + halfH,
      };
    }
    case 'GEO_polygon':
    case 'straightLine': {
      const pts = g.points;
      if (!Array.isArray(pts) || pts.length === 0) {return null;}
      let left = pts[0].x;
      let right = pts[0].x;
      let top = pts[0].y;
      let bottom = pts[0].y;
      for (const p of pts) {
        if (p.x < left) {left = p.x;}
        if (p.x > right) {right = p.x;}
        if (p.y < top) {top = p.y;}
        if (p.y > bottom) {bottom = p.y;}
      }
      return {left, right, top, bottom};
    }
    default:
      return null;
  }
}

/**
 * True when two rects match within the given tolerance (default 1px — e-ink
 * coordinates are integers). Used to skip baking when the user hasn't
 * actually resized the lasso.
 */
export function boundsMatch(a: Rect, b: Rect, tol = 1): boolean {
  return (
    Math.abs(a.left - b.left) <= tol &&
    Math.abs(a.right - b.right) <= tol &&
    Math.abs(a.top - b.top) <= tol &&
    Math.abs(a.bottom - b.bottom) <= tol
  );
}

/**
 * Estimate how much larger than the vertex AABB the firmware's lasso rect
 * will be, purely due to stroke thickness + miter joins at polygon vertices.
 *
 * Why this exists: `geometryNaturalBounds` returns the *vertex* AABB, but
 * `PluginCommAPI.getLassoRect()` reports the *visual* bounds, which the
 * firmware inflates by roughly half the pen-stroke extent on each side, plus
 * miter safety at sharp angles. Empirically on Chauvet firmware 3.27.41
 * (Supernote Nomad) this was 6-17px for penWidth=900 on a parallelogram —
 * see logcat-phase1.txt.
 *
 * If we compare natural to lasso with a 1px tolerance, that built-in padding
 * looks exactly like a user resize and we mistakenly bake it into the stored
 * coordinates on every `modifyLassoGeometry` call. The shape then visibly
 * grows by ~10-20px every time the user tweaks a property — which is exactly
 * what the v1.0.1 Reddit reviewer flagged and what v1.0.2 alpha 1 still did.
 *
 * The coefficient here (penWidth / 40, floor 10) was fitted to the logcat
 * observations. It is deliberately generous so that ordinary user resizes
 * (typically 50%+ delta on at least one axis) still trigger baking.
 */
export function defaultLassoTolerance(penWidth: number): number {
  if (!Number.isFinite(penWidth) || penWidth <= 0) {return 10;}
  return Math.max(10, Math.ceil(penWidth / 40));
}

function rectWidth(r: Rect): number {
  return r.right - r.left;
}

function rectHeight(r: Rect): number {
  return r.bottom - r.top;
}

/**
 * Linearly re-map a geometry's coordinates from `fromRect` to `toRect`.
 *
 * Preserves geometry type and all non-coordinate fields (pen style, angle,
 * extras). Returns a new object; does not mutate input.
 *
 * For rotated ellipses we can't perfectly represent a non-uniform scale
 * (the result would be a sheared ellipse, which the firmware can't store).
 * We approximate by projecting the world-space (sx, sy) onto the local
 * rotated axes: a 0° ellipse scales its major radius by sx and minor by sy,
 * a 90° ellipse swaps them, and a 45° ellipse gets the average. This is
 * the best single-parameter-per-axis approximation for the API shape.
 */
export function applyRectTransform(g: Geometry, fromRect: Rect, toRect: Rect): Geometry {
  const fw = rectWidth(fromRect);
  const fh = rectHeight(fromRect);
  if (Math.abs(fw) < EPSILON || Math.abs(fh) < EPSILON) {
    // Degenerate source rect — cannot scale. Return input unchanged.
    return g;
  }
  const sx = rectWidth(toRect) / fw;
  const sy = rectHeight(toRect) / fh;
  const mapX = (x: number) => toRect.left + (x - fromRect.left) * sx;
  const mapY = (y: number) => toRect.top + (y - fromRect.top) * sy;

  switch (g.type) {
    case 'GEO_circle':
    case 'GEO_ellipse': {
      const c = g.ellipseCenterPoint;
      const rMaj = g.ellipseMajorAxisRadius;
      const rMin = g.ellipseMinorAxisRadius;
      const angle = g.ellipseAngle ?? 0;
      if (!c || typeof rMaj !== 'number' || typeof rMin !== 'number') {
        return g;
      }
      const theta = angle * DEG;
      const cos2 = Math.cos(theta) ** 2;
      const sin2 = Math.sin(theta) ** 2;
      // Project world-space (sx, sy) onto the ellipse's local axes.
      // At θ=0 this is (sx, sy); at θ=90° it swaps to (sy, sx); at 45° it's
      // the mean of the two.
      const sMaj = Math.abs(sx) * cos2 + Math.abs(sy) * sin2;
      const sMin = Math.abs(sx) * sin2 + Math.abs(sy) * cos2;
      return {
        ...g,
        ellipseCenterPoint: {x: mapX(c.x), y: mapY(c.y)},
        ellipseMajorAxisRadius: rMaj * sMaj,
        ellipseMinorAxisRadius: rMin * sMin,
        // ellipseAngle intentionally preserved.
      };
    }
    case 'GEO_polygon':
    case 'straightLine': {
      const pts = g.points;
      if (!Array.isArray(pts)) {return g;}
      return {
        ...g,
        points: pts.map(p => ({x: mapX(p.x), y: mapY(p.y)})),
      };
    }
    default:
      return g;
  }
}

/**
 * Convenience wrapper: if the lasso rect differs from the geometry's own
 * natural bounds by more than `tol`, bake the delta into the geometry.
 * Returns the (possibly unchanged) geometry.
 *
 * When `tol` is not provided it is auto-computed from `g.penWidth` via
 * `defaultLassoTolerance` to absorb the firmware's stroke-padding inflation
 * of the lasso rect. Pass an explicit `tol` (e.g. 1) to override — that's
 * useful in unit tests that want to verify transform behavior without the
 * padding heuristic.
 *
 * Returns the input unchanged when:
 *   - the lasso rect is null,
 *   - the geometry type is unknown,
 *   - the lasso rect matches the natural bounds within tolerance
 *     (no user resize detected), or
 *   - either rect is degenerate.
 */
export function bakeLassoResize(g: Geometry, lassoRect: Rect | null, tol?: number): Geometry {
  if (!lassoRect) {return g;}
  const natural = geometryNaturalBounds(g);
  if (!natural) {return g;}
  const effectiveTol = tol ?? defaultLassoTolerance(g.penWidth);
  if (boundsMatch(natural, lassoRect, effectiveTol)) {return g;}
  return applyRectTransform(g, natural, lassoRect);
}
