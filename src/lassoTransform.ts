/**
 * Lasso-transform utilities: pure geometry bounds and rect remapping.
 *
 * Consumers:
 *   - placement.ts fits a freshly built shape to a tap point or dragged
 *     box at insert time (#15).
 *   - the Edit Shape panel stretches a lassoed shape onto a new box and
 *     writes it back with `modifyLassoGeometry` (#17). The remap is
 *     absolute from the geometry's *stored* coordinates, so any pending
 *     native lasso resize (which `getLassoGeometries()` does not reflect)
 *     is simply replaced rather than baked in.
 *
 * No RN / SDK imports, so everything here is host-testable.
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
 * extras). Returns a new object; does not mutate input. A degenerate axis
 * of `fromRect` (zero width or height) is translated rather than scaled.
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
  // A degenerate source axis (e.g. the horizontal Line shape has zero
  // height) cannot be scaled, but it can still be *moved*: map the axis
  // midpoint of `fromRect` onto the midpoint of `toRect`. Without this,
  // tap-to-place / drag-to-size would silently leave a Line at its
  // build-time position. The non-degenerate axis keeps its linear remap.
  const degenerateX = Math.abs(fw) < EPSILON;
  const degenerateY = Math.abs(fh) < EPSILON;
  const sx = degenerateX ? 1 : rectWidth(toRect) / fw;
  const sy = degenerateY ? 1 : rectHeight(toRect) / fh;
  const mapX = degenerateX
    ? (x: number) => x + (toRect.left + toRect.right - fromRect.left - fromRect.right) / 2
    : (x: number) => toRect.left + (x - fromRect.left) * sx;
  const mapY = degenerateY
    ? (y: number) => y + (toRect.top + toRect.bottom - fromRect.top - fromRect.bottom) / 2
    : (y: number) => toRect.top + (y - fromRect.top) * sy;

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
 * Loose view of sn-plugin-lib's `LassoElementTypeNum`. The firmware may
 * omit fields, so every value is checked before use.
 */
export type LassoCounts = Readonly<Record<string, unknown>>;

/** Element kinds that make a lasso selection more than "one shape". */
const NON_GEOMETRY_COUNT_FIELDS = [
  'trailNum',
  'titleNum',
  'bitmapNum',
  'normalTextBoxNum',
  'digestTextBoxNum',
  'digestTextBoxEditableNum',
  'trailLinkNum',
  'textLinkNum',
  'todoLinkNum',
] as const;

/**
 * True when the lasso holds exactly one geometry and nothing else (#17).
 *
 * `geometryCount` is the length of `getLassoGeometries()`; `counts` is
 * `getLassoElementTypeCounts()`. When the counts call failed (null) the
 * rule degrades to the geometry list alone. Otherwise `geometryNum` must
 * be 1 and every non-geometry kind 0 or absent — a mixed selection is
 * refused rather than stretching only its geometry against a box the
 * user drew around several things. Geometry subtype counts
 * (`straightLineNum`, `circleNum`, `ellipseNum`) are ignored.
 * DEVICE-UNVERIFIED: that a lone shape reports `trailNum` 0.
 */
export function isSingleGeometrySelection(counts: LassoCounts | null, geometryCount: number): boolean {
  if (geometryCount !== 1) {return false;}
  if (!counts) {return true;}
  if (counts.geometryNum !== 1) {return false;}
  return NON_GEOMETRY_COUNT_FIELDS.every(k => {
    const v = counts[k];
    return typeof v !== 'number' || v === 0;
  });
}

function isFiniteRect(r: Rect): boolean {
  return [r.left, r.top, r.right, r.bottom].every(Number.isFinite);
}

/**
 * Stretch `g` so its stored natural bounds land exactly on `target` (#17).
 *
 * The remap is absolute, so a pending native lasso resize needs no
 * baking: `modifyLassoGeometry` with the new coordinates replaces it. A
 * circle stretched unevenly becomes a `GEO_ellipse` (same fields, Major
 * and Minor radii diverge); the relative tolerance keeps float noise on
 * large radii from flipping the type. Pen props and every other
 * non-coordinate field are preserved; the input is never mutated.
 *
 * Returns null when the bounds cannot be determined (unknown type or
 * malformed geometry) or the target is non-finite or inverted.
 */
export function resizeGeometryTo(g: Geometry, target: Rect): Geometry | null {
  const natural = geometryNaturalBounds(g);
  if (!natural || !isFiniteRect(target)) {return null;}
  if (target.right < target.left || target.bottom < target.top) {return null;}
  const out = applyRectTransform(g, natural, target);
  if (out.type !== 'GEO_circle') {return out;}
  const major = out.ellipseMajorAxisRadius as number;
  const minor = out.ellipseMinorAxisRadius as number;
  const uneven = Math.abs(major - minor) > EPSILON * Math.max(major, minor);
  return uneven ? {...out, type: 'GEO_ellipse'} : out;
}
