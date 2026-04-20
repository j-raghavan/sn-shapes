/**
 * Build-time shape-PNG renderer.
 *
 * Walks SHAPES from src/shapes.ts, calls each shape.build() with its
 * declared default parameters, then rasterises the resulting geometry
 * into palette-icon PNGs under assets/shapes/shape_<id>.png (96×96).
 *
 * RN bundles these as drawable resources; the ShapePalette grid renders
 * them at 48 px. There's no second output track any more — the
 * composite insert-bitmap path was removed in v1.0.4 (see
 * ShapeBuildResult doc in shapes.ts). Every shape is now a single
 * Geometry and inserts on-device via PluginCommAPI.insertGeometry.
 *
 * Why build-time (not runtime):
 *   - React-native's Image component wants static PNG sources. Rendering
 *     on-device via SkiaView / react-native-svg would pull in a second
 *     rasterisation pipeline just for the palette; the firmware already
 *     expects static assets and downscales them cleanly.
 *   - Icons are deterministic from their geometry. Rendering once on
 *     the dev's machine + shipping the PNGs beats re-rasterising on
 *     every plugin launch on a low-end e-ink SoC.
 *
 * Canvas sizing rationale:
 *   - 96×96 = ~2× the palette's 48-px display size. RN downscales 2×
 *     source cleanly on e-ink without aliasing; authoring at 1× (48 px)
 *     left visible staircase on circles/ellipses.
 *   - 4-px uniform stroke is the single biggest factor that makes the
 *     icon set read as one coherent family. The shape's own
 *     PEN_DEFAULTS.penWidth is in firmware µm units (~500), which would
 *     over-stroke at 96 px; we override with a canvas-pixel value here.
 */
import {mkdirSync, existsSync} from 'fs';
import {writeFile} from 'fs/promises';
import {join, resolve} from 'path';
import {createCanvas, type SKRSContext2D} from '@napi-rs/canvas';

import {
  SHAPES,
  PEN_DEFAULTS,
  type Geometry,
  type Point,
  type Shape,
} from '../src/shapes';

// ---------------------------------------------------------------------------
// Render profile
// ---------------------------------------------------------------------------

type RenderProfile = {
  readonly canvasSize: number;
  readonly paddingPx: number;
  readonly strokePx: number;
  readonly outputDir: string;
};

// Resolve relative to THIS file's directory so the script is runnable
// from anywhere (repo root, CI workdir, monorepo parent, …).
const PROJECT_ROOT = resolve(__dirname, '..');

const ICON_PROFILE: RenderProfile = {
  canvasSize: 96,
  paddingPx: 8,
  strokePx: 4,
  outputDir: join(PROJECT_ROOT, 'assets', 'shapes'),
};

function contentSize(p: RenderProfile): number {
  // Half the stroke width rides the content bbox on each side, so subtract
  // the full stroke width once from the usable inner region.
  return p.canvasSize - p.paddingPx * 2 - p.strokePx;
}

// ---------------------------------------------------------------------------
// Bounding-box computation
// ---------------------------------------------------------------------------

type Bbox = {minX: number; minY: number; maxX: number; maxY: number};

const EMPTY_BBOX: Bbox = {
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
};

function expandBbox(b: Bbox, p: Point): Bbox {
  return {
    minX: Math.min(b.minX, p.x),
    minY: Math.min(b.minY, p.y),
    maxX: Math.max(b.maxX, p.x),
    maxY: Math.max(b.maxY, p.y),
  };
}

function geometryBbox(g: Geometry): Bbox {
  switch (g.type) {
    case 'GEO_polygon':
    case 'straightLine':
      return g.points.reduce(expandBbox, EMPTY_BBOX);
    case 'GEO_circle':
      return {
        minX: g.ellipseCenterPoint.x - g.ellipseMajorAxisRadius,
        minY: g.ellipseCenterPoint.y - g.ellipseMajorAxisRadius,
        maxX: g.ellipseCenterPoint.x + g.ellipseMajorAxisRadius,
        maxY: g.ellipseCenterPoint.y + g.ellipseMajorAxisRadius,
      };
    case 'GEO_ellipse':
      // ellipseAngle is 0 for every shape in SHAPES today; if that changes
      // the bbox will be slightly loose (circumscribing rect), which is
      // fine for icon fitting since we also apply PADDING_PX.
      return {
        minX: g.ellipseCenterPoint.x - g.ellipseMajorAxisRadius,
        minY: g.ellipseCenterPoint.y - g.ellipseMinorAxisRadius,
        maxX: g.ellipseCenterPoint.x + g.ellipseMajorAxisRadius,
        maxY: g.ellipseCenterPoint.y + g.ellipseMinorAxisRadius,
      };
  }
}

// ---------------------------------------------------------------------------
// Fit transform
// ---------------------------------------------------------------------------

type Fit = {scale: number; tx: number; ty: number};

function computeFit(bbox: Bbox, profile: RenderProfile): Fit {
  const w = bbox.maxX - bbox.minX;
  const h = bbox.maxY - bbox.minY;
  // Degenerate geometries (zero-size lines, empty builds) land at the
  // canvas centre rather than blowing up the divide-by-zero below.
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return {scale: 1, tx: profile.canvasSize / 2, ty: profile.canvasSize / 2};
  }
  const scale = contentSize(profile) / Math.max(w, h);
  const scaledW = w * scale;
  const scaledH = h * scale;
  // Center the scaled bbox inside the canvas; tx/ty are applied AFTER
  // subtracting bbox.minX/minY inside project().
  const tx = (profile.canvasSize - scaledW) / 2 - bbox.minX * scale;
  const ty = (profile.canvasSize - scaledH) / 2 - bbox.minY * scale;
  return {scale, tx, ty};
}

function project(p: Point, fit: Fit): Point {
  return {x: p.x * fit.scale + fit.tx, y: p.y * fit.scale + fit.ty};
}

// ---------------------------------------------------------------------------
// Rasterisation
// ---------------------------------------------------------------------------

function drawGeometry(
  ctx: SKRSContext2D,
  geometry: Geometry,
  fit: Fit,
): void {
  ctx.beginPath();
  switch (geometry.type) {
    case 'GEO_polygon': {
      const pts = geometry.points.map(p => project(p, fit));
      if (pts.length === 0) {return;}
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      break;
    }
    case 'straightLine': {
      const pts = geometry.points.map(p => project(p, fit));
      if (pts.length < 2) {return;}
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      break;
    }
    case 'GEO_circle': {
      const c = project(geometry.ellipseCenterPoint, fit);
      const r = geometry.ellipseMajorAxisRadius * fit.scale;
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      break;
    }
    case 'GEO_ellipse': {
      const c = project(geometry.ellipseCenterPoint, fit);
      const rx = geometry.ellipseMajorAxisRadius * fit.scale;
      const ry = geometry.ellipseMinorAxisRadius * fit.scale;
      ctx.ellipse(c.x, c.y, rx, ry, geometry.ellipseAngle, 0, Math.PI * 2);
      break;
    }
  }
  ctx.stroke();
}

async function renderShape(shape: Shape): Promise<string> {
  const params = Object.fromEntries(
    shape.parameters.map(p => [p.id, p.defaultValue]),
  );
  // Centre at the origin — computeFit normalises everything via bbox,
  // so the build centre is irrelevant as long as it's consistent.
  const geometry = shape.build({x: 0, y: 0}, params, PEN_DEFAULTS);
  const bbox = geometryBbox(geometry);
  const fit = computeFit(bbox, ICON_PROFILE);

  const canvas = createCanvas(ICON_PROFILE.canvasSize, ICON_PROFILE.canvasSize);
  const ctx = canvas.getContext('2d');
  // Transparent background — the palette renders icons against the
  // cell fill so baking a white rect here would clip the selected-cell
  // highlight.
  ctx.clearRect(0, 0, ICON_PROFILE.canvasSize, ICON_PROFILE.canvasSize);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = ICON_PROFILE.strokePx;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  drawGeometry(ctx, geometry, fit);

  const outPath = join(ICON_PROFILE.outputDir, `shape_${shape.id}.png`);
  const png = await canvas.encode('png');
  await writeFile(outPath, png);
  return outPath;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!existsSync(ICON_PROFILE.outputDir)) {
    mkdirSync(ICON_PROFILE.outputDir, {recursive: true});
  }
  const paths = await Promise.all(SHAPES.map(renderShape));
  for (const p of paths) {
    // Log path relative to project root for readability in CI.
    console.log(`  rendered ${p.replace(PROJECT_ROOT + '/', '')}`);
  }
  console.log(
    `Rendered ${paths.length} palette icons to ${ICON_PROFILE.outputDir}`,
  );
}

main().catch(err => {
  console.error('render-icons failed:', err);
  process.exit(1);
});
