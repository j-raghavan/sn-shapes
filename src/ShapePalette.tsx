/**
 * ShapePalette — the only "Shapes" popup (toolbar button id=100).
 *
 * Hybrid-grid design (2026-04-18 revision):
 *   Row 1: Shapes grid (left) + Preview (right)              — two-col
 *   Row 2: Stroke Width (5 presets: XS / S / M / L / XL)     — full width
 *   Row 3: Stroke Color (5 grey levels)                       — full width
 *
 * Pen Type is intentionally NOT a row here — it's a top-level selection
 * in the firmware's main drawing surface (left-sidebar pen stack), so
 * duplicating it would add a decision without giving the user anything
 * they couldn't set outside. Inserted geometries carry the default
 * penType (Fineliner); users can swap pens in the main UI before the
 * shape is drawn, or re-style after the shape auto-lassos post-insert.
 *
 * The earlier two-column design put the pickers below the shapes in the
 * left column, which left the right column with a large expanse of empty
 * space below the preview. The hybrid grid keeps the "what will it look
 * like" preview visible next to the shape choice (the two decisions that
 * want to be considered together) while letting the pickers span the full
 * panel width for comfortable tap targets.
 *
 * Commit flow — NO explicit Insert button:
 *   1. Tapping a shape cell selects it (no insert yet).
 *   2. Tapping a picker option mutates a local pendingStyle — the
 *      relevant picker cell highlights and the preview updates.
 *   3. Tapping OUTSIDE the panel (the overlay) commits: builds the
 *      Geometry with the chosen style and inserts via
 *      PluginCommAPI.insertGeometry. On success the popup closes; on
 *      failure an error banner appears and the popup stays open so the
 *      user can retry or edit their choices. The ✕ button in the header
 *      remains the explicit "cancel without inserting" affordance.
 *   4. Dropping the Insert button is user-driven (2026-04-18): once the
 *      popup only exists for picking + one-shot inserting, an explicit
 *      button is redundant — "tap outside to commit" reads as "I'm done"
 *      which is exactly the one thing the user can do.
 *
 * Why a single popup (no separate Shape Options dialog):
 *   - Earlier prototype had two popups: Shapes (id=100) for picking +
 *     inserting, and Shape Options (id=200, lasso-toolbar contextual)
 *     for re-styling a lassoed shape.
 *   - Once this popup grew to host width/colour/pen-type pickers, the
 *     contextual Shape Options panel became redundant — every option it
 *     offered was already set at insert time. Per user direction
 *     2026-04-18, the id=200 button + ShapeOptionsPanel routing were
 *     removed; this popup is now the only entry point for shapes.
 *   - ShapeOptionsPanel.tsx itself is kept on disk because it owns the
 *     WIDTH_PRESETS / COLOR_PRESETS / PEN_TYPE_PRESETS constants and
 *     helper utilities that this popup imports. The component export is
 *     no longer rendered anywhere; only its constants are used.
 *
 * Why deferred-apply (instead of tap-to-insert + style after):
 *   - Firmware bug: modifyLassoGeometry silently drops pen props in
 *     Chauvet 3.27.41 (see prior diagnosis). The reliable path is to
 *     bake the desired style into the Geometry at insert time, since
 *     insertGeometry DOES honour pen props.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  View,
  Image,
  Text,
  Pressable,
  StyleSheet,
  ImageSourcePropType,
  ScrollView,
} from 'react-native';
import {
  PluginCommAPI,
  PluginManager,
  PluginFileAPI,
} from 'sn-plugin-lib';
import {
  SHAPES,
  Shape,
  ShapeId,
  PenStyle,
  PEN_DEFAULTS,
  ShapeCategory,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  shapesInCategory,
  nextCategory,
} from './shapes';
import {
  WIDTH_PRESETS,
  COLOR_PRESETS,
  isAcceptablePenWidth,
} from './ShapeOptionsPanel';
import StrokePreview from './StrokePreview';

// 2026-04-18 design change: the Pen Type picker is intentionally NOT
// rendered here. Pen type is already a top-level selection in the
// firmware's main drawing surface (the left-sidebar pen stack), so
// duplicating it inside the Shapes popup just adds another decision
// without giving the user anything they couldn't set outside. The
// inserted geometry still carries PEN_DEFAULTS.penType so the firmware
// accepts it — users who want a different pen on their shape can swap
// pens in the main UI before drawing or re-style via the pen picker
// after the shape lassos.

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_WIDTH = 1404;
export const DEFAULT_PAGE_HEIGHT = 1872;

export const TEST_IDS = {
  overlay: 'shapes-overlay',
  cell: (id: ShapeId) => `shape-cell-${id}`,
  widthButton: (w: number) => `shapes-width-${w}`,
  colorButton: (c: number) => `shapes-color-${c}`,
  error: 'shapes-error',
  // Explicit "cancel without inserting" affordance in the header. The
  // overlay tap commits; the ✕ button cancels. Distinct testID so tests
  // can exercise the cancel path without heuristically walking the tree.
  closeButton: 'shapes-close-button',
  // Row 1 columns — tests use these to verify the grid + preview layout.
  shapesColumn: 'shapes-shapes-column',
  previewColumn: 'shapes-preview-column',
  // Full-width rows below Row 1. The Pen Type row was dropped 2026-04-18;
  // see file header for rationale.
  widthRow: 'shapes-width-row',
  colorRow: 'shapes-color-row',
  // Centered tagline at the bottom of the panel (added 2026-04-20). Kept
  // as its own testID so layout tests can assert order without text-content
  // matching, which is brittle if we ever localise.
  footer: 'shapes-footer',
  // Carousel header (added 2026-04-20) that cycles shape groups — prev
  // arrow, group label, next arrow. Tests target these testIDs to assert
  // wrap-around and auto-select-first-in-group invariants without peeking
  // at the rendered tree's Text children.
  groupHeader: 'shapes-group-header',
  groupPrev: 'shapes-group-prev',
  groupNext: 'shapes-group-next',
  groupLabel: 'shapes-group-label',
} as const;

/**
 * PNG icon for each shape. Authored at ~48 px native; the cell renders
 * them at THUMBNAIL_SIZE so they stay within their authoring resolution
 * and don't alias on e-ink. SHAPES and SHAPE_ICONS must stay in sync —
 * this is `Record<ShapeId, ...>` (not Partial) so TypeScript flags any
 * shape that's missing an icon. The StrokePreview on the right column
 * reuses the same icons (tinted with pen colour) so the preview mirrors
 * the grid selection exactly.
 */
export const SHAPE_ICONS: Record<ShapeId, ImageSourcePropType> = {
  // Basic
  rectangle: require('../assets/shapes/shape_rectangle.png'),
  circle: require('../assets/shapes/shape_circle.png'),
  roundedRect: require('../assets/shapes/shape_roundedRect.png'),
  ellipse: require('../assets/shapes/shape_ellipse.png'),
  triangle: require('../assets/shapes/shape_triangle.png'),
  diamond: require('../assets/shapes/shape_diamond.png'),
  pentagon: require('../assets/shapes/shape_pentagon.png'),
  hexagon: require('../assets/shapes/shape_hexagon.png'),
  heptagon: require('../assets/shapes/shape_heptagon.png'),
  octagon: require('../assets/shapes/shape_octagon.png'),
  line: require('../assets/shapes/shape_line.png'),
  parallelogram: require('../assets/shapes/shape_parallelogram.png'),
  // Arrows
  blockArrow: require('../assets/shapes/shape_blockArrow.png'),
  doubleArrow: require('../assets/shapes/shape_doubleArrow.png'),
  thickArrow: require('../assets/shapes/shape_thickArrow.png'),
  ballArrow: require('../assets/shapes/shape_ballArrow.png'),
  chevronTailArrow: require('../assets/shapes/shape_chevronTailArrow.png'),
  refreshArrow: require('../assets/shapes/shape_refreshArrow.png'),
  // Flowchart
  flowchartPreparation: require('../assets/shapes/shape_flowchartPreparation.png'),
  flowchartDocument: require('../assets/shapes/shape_flowchartDocument.png'),
  flowchartTerminator: require('../assets/shapes/shape_flowchartTerminator.png'),
  flowchartManualInput: require('../assets/shapes/shape_flowchartManualInput.png'),
  // Decorative
  certificate: require('../assets/shapes/shape_certificate.png'),
  ribbon: require('../assets/shapes/shape_ribbon.png'),
  banner: require('../assets/shapes/shape_banner.png'),
  starburst: require('../assets/shapes/shape_starburst.png'),
  awardBadge: require('../assets/shapes/shape_awardBadge.png'),
  // Others
  plus: require('../assets/shapes/shape_plus.png'),
  lightning: require('../assets/shapes/shape_lightning.png'),
  trapezoid: require('../assets/shapes/shape_trapezoid.png'),
};

// Fixed panel width so layout is deterministic (Nomad is 1404 px wide —
// a 404 px panel leaves ample room for the main page view on the right).
// Sizing history:
//   • v1.0.1: 560 px (roomy but dominated the screen on Manta).
//   • v1.0.3: 336 px (60 % of v1.0.1) — compact but user flagged it as
//     "cramped" once the carousel + decorative category shipped.
//   • v1.0.4: 404 px (+20 % from 336) per user directive 2026-04-20. All
//     internal geometry (padding, gaps, cell size, preview frame, font
//     sizes) scales by the same 1.2 factor so proportions are preserved.
const PANEL_WIDTH = 404;
const PANEL_PADDING = 10;
// Gap between shapes column and preview column in Row 1 only.
const ROW1_GAP = 10;
// Fixed right-column width in Row 1. 130 px fits the 38-px preview icon
// plus the width-sample bar plus padding (was 108 px at the 336-px panel
// size, scaled by 1.2 alongside the panel bump).
const PREVIEW_COLUMN_WIDTH = 130;
const SHAPES_COLUMN_WIDTH =
  PANEL_WIDTH - PANEL_PADDING * 2 - ROW1_GAP - PREVIEW_COLUMN_WIDTH;

const GRID_COLS = 4;
const GRID_GAP = 4;

// Cell sizing: thumbnail + fixed padding on each side. Thumbnails render
// at 36 px (below the PNG authoring resolution of 48 px — RN downscales
// cleanly without the aliasing we'd see going *above* native) with 10 px
// padding per side. Both values were scaled by 1.2 from the v1.0.3 pair
// (30 / 8) as part of the 2026-04-20 panel upsize.
const CELL_PADDING_PX = 10;
const THUMBNAIL_SIZE = 36;
const CELL_SIZE = THUMBNAIL_SIZE + CELL_PADDING_PX * 2; // 56
// Sanity: GRID_COLS*CELL_SIZE + (GRID_COLS-1)*GRID_GAP must fit inside
// SHAPES_COLUMN_WIDTH. At GRID_COLS=4 that's 4*56 + 3*4 = 236 ≤
// SHAPES_COLUMN_WIDTH (244) — 8 px of breathing room absorbed by the
// column's native centering.

// Breathing-room padding added below the last row so the final row of
// thumbnails doesn't butt up against the grid's inner edge.
const GRID_VERTICAL_PADDING_PX = 8;

/**
 * Rows needed to show the largest category without scrolling.
 *
 * Computed at module load time from the authoritative SHAPES + category
 * data so the grid's fixed height auto-adjusts when shapes are added or
 * removed. Prior revision hard-coded 188 px for the current 12-shape
 * basic category, which would silently start scrolling if someone added
 * a 13th basic shape — users would assume the new shape "didn't ship"
 * because the grid height wouldn't grow to reveal it. Deriving from
 * CATEGORY_ORDER means a new category is a zero-line change here.
 */
const MAX_GRID_ROWS = Math.max(
  ...CATEGORY_ORDER.map(c =>
    Math.ceil(shapesInCategory(c).length / GRID_COLS),
  ),
);

/**
 * Fixed shapes-grid height. We pin this rather than using maxHeight so
 * the overall popup footprint stays constant as the user cycles
 * categories — otherwise switching basic (3 rows) → decorative (1 row)
 * visibly shrinks the panel and bounces the preview / pickers / footer
 * up the screen on every ◀/▶ tap (user flagged this 2026-04-20).
 *
 * Smaller categories leave predictable whitespace below their last row;
 * the stable overall layout matters more than filling every pixel.
 */
const GRID_HEIGHT_PX =
  MAX_GRID_ROWS * CELL_SIZE +
  (MAX_GRID_ROWS - 1) * GRID_GAP +
  GRID_VERTICAL_PADDING_PX;

// Local narrow type for sn-plugin-lib responses. The SDK declares its
// methods as returning the generic `Object` type, so TS doesn't know
// about the `{success, result}` envelope the firmware actually returns.
type ApiRes<T> = {success: boolean; result?: T; error?: {message?: string}} | null | undefined;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolvePageSize(): Promise<{width: number; height: number}> {
  try {
    const pathRes = (await PluginCommAPI.getCurrentFilePath()) as ApiRes<string>;
    const pageRes = (await PluginCommAPI.getCurrentPageNum()) as ApiRes<number>;
    if (
      pathRes?.success &&
      pageRes?.success &&
      typeof pathRes.result === 'string' &&
      typeof pageRes.result === 'number'
    ) {
      const sizeRes = (await PluginFileAPI.getPageSize(
        pathRes.result,
        pageRes.result,
      )) as ApiRes<{width: number; height: number}>;
      if (sizeRes?.success && sizeRes.result) {
        return sizeRes.result;
      }
    }
  } catch {
    // Fall through to defaults.
  }
  return {width: DEFAULT_PAGE_WIDTH, height: DEFAULT_PAGE_HEIGHT};
}

/**
 * Insert a shape at the page center with the user's chosen style baked
 * in. Every shape in SHAPES builds exactly one Geometry (v1.0.4), so
 * the insert is always a single `PluginCommAPI.insertGeometry` call —
 * the inserted element respects the user's PenStyle (colour + width +
 * pen type), stays crisp at any zoom, and remains editable as a single
 * ink stroke. We set `showLassoAfterInsert` so the user can immediately
 * reposition without a second tap.
 *
 * The earlier hybrid image-insert path for multi-Geometry composites
 * (cube, cylinder, axes, …) was removed in v1.0.4. Firmware
 * (Chauvet 3.27.41) has no grouping primitive and the `insertImage`
 * fallback we'd been using baked the stroke into a PNG — so colour
 * and width sliders, rotation, and single-element lasso all stopped
 * applying. Offering those shapes half-working read as "these controls
 * silently do nothing here"; dropping them is the simpler, honest fix.
 *
 * Fail-fast: any failure surfaces as a thrown error that the overlay
 * handler catches and shows in the banner. Insert is atomic on the
 * firmware side, so there's no partial-state cleanup to worry about.
 */
async function insertShape(
  shape: Shape,
  style: PenStyle,
  pageWidth: number,
  pageHeight: number,
): Promise<void> {
  const center = {x: pageWidth / 2, y: pageHeight / 2};
  const params = Object.fromEntries(
    shape.parameters.map(p => [p.id, p.defaultValue]),
  );
  const geometry = shape.build(center, params, style);
  // Auto-lasso the element so users can immediately drag it — the
  // element IS the shape.
  geometry.showLassoAfterInsert = true;
  const res = (await PluginCommAPI.insertGeometry(geometry)) as ApiRes<unknown>;
  if (!res?.success) {
    console.error('insertGeometry failed:', JSON.stringify(res));
    throw new Error(res?.error?.message ?? 'insertGeometry failed');
  }
}

const ERROR_DISPLAY_MS = 2000;

/**
 * Pick the geometry type for the StrokePreview fallback. Builds the
 * shape with default params + the current style at the page origin,
 * just to read its `type` field (GEO_polygon / GEO_circle /
 * GEO_ellipse / straightLine). Pure — no side effects. Only consulted
 * when the preview can't render from the PNG icon for some reason.
 */
function previewShapeType(shape: Shape, style: PenStyle): string | undefined {
  const CENTER = {x: 0, y: 0};
  const params = Object.fromEntries(
    shape.parameters.map(p => [p.id, p.defaultValue]),
  );
  return shape.build(CENTER, params, style).type;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ShapePalette() {
  const insertingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pageWidth, setPageWidth] = useState(DEFAULT_PAGE_WIDTH);
  const [pageHeight, setPageHeight] = useState(DEFAULT_PAGE_HEIGHT);

  // Selection state. Default to rectangle — matches the native popup's
  // typical landing state and gives the preview something to show before
  // the user makes any selection.
  const [selectedId, setSelectedId] = useState<ShapeId>('rectangle');
  const [style, setStyle] = useState<PenStyle>(PEN_DEFAULTS);

  // Carousel state. The palette shows one category at a time; prev/next
  // arrows in the header cycle CATEGORY_ORDER with wrap-around. Default
  // category lines up with the default selectedId ('rectangle' ∈ basic)
  // so the initial render is self-consistent without any post-mount work.
  const [selectedCategory, setSelectedCategory] =
    useState<ShapeCategory>('basic');

  // ScrollView ref so we can reset to y=0 whenever the category changes —
  // users scrolled halfway down Basic shouldn't land halfway down Arrows.
  const gridScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    resolvePageSize().then(({width, height}) => {
      setPageWidth(width);
      setPageHeight(height);
    });
    return () => {
      if (errorTimerRef.current) {clearTimeout(errorTimerRef.current);}
    };
  }, []);

  // Shapes shown in the grid right now — filtered by the current carousel
  // group. Memoised on `selectedCategory` so the filter cost (O(SHAPES))
  // only runs on group change, not on every stroke-width tap.
  const visibleShapes = useMemo(
    () => shapesInCategory(selectedCategory),
    [selectedCategory],
  );

  const selectedShape = useMemo(
    () => SHAPES.find(s => s.id === selectedId) ?? SHAPES[0],
    [selectedId],
  );

  const previewType = useMemo(
    () => previewShapeType(selectedShape, style),
    [selectedShape, style],
  );

  const previewIcon = SHAPE_ICONS[selectedShape.id];

  const showError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimerRef.current) {clearTimeout(errorTimerRef.current);}
    errorTimerRef.current = setTimeout(() => setError(null), ERROR_DISPLAY_MS);
  }, []);

  const handleShapeTap = useCallback((shape: Shape) => {
    if (insertingRef.current) {return;}
    setSelectedId(shape.id);
  }, []);

  const handleWidthPress = useCallback((value: number) => {
    if (insertingRef.current) {return;}
    if (!isAcceptablePenWidth(value)) {return;}
    setStyle(prev => ({...prev, penWidth: value}));
  }, []);

  const handleColorPress = useCallback((value: number) => {
    if (insertingRef.current) {return;}
    setStyle(prev => ({...prev, penColor: value}));
  }, []);

  /**
   * Advance the carousel to the previous (-1) or next (+1) group.
   *
   * Side-effects bundled here so each arrow tap is atomic from the user's
   * POV:
   *   1. Switch the visible category (wraps via `nextCategory`).
   *   2. Auto-select the first shape of the new group so the preview and
   *      commit path have a valid selection. Otherwise the previously
   *      selected shape would remain "selected" but invisible (not in
   *      the filtered grid), which reads as broken.
   *   3. Reset the shapes ScrollView to the top — a user scrolled halfway
   *      into Basic shouldn't land halfway into Arrows.
   *
   * Ignored while an insert is in flight, matching the other handlers.
   */
  const cycleCategory = useCallback((direction: 1 | -1) => {
    if (insertingRef.current) {return;}
    setSelectedCategory(prev => {
      const next = nextCategory(prev, direction);
      const firstInNext = shapesInCategory(next)[0];
      if (firstInNext) {setSelectedId(firstInNext.id);}
      // Schedule the scroll reset for after the state flush. scrollTo on
      // a not-yet-updated ScrollView is a no-op but safe.
      gridScrollRef.current?.scrollTo({y: 0, animated: false});
      return next;
    });
  }, []);

  /**
   * Tapping OUTSIDE the panel = "commit and close". Replaces the old
   * explicit Insert button (2026-04-18). If the insert fails we keep the
   * popup open and flash an error banner so the user can retry without
   * losing their selection.
   *
   * The ✕ button in the header remains a distinct, explicit "cancel"
   * affordance — it calls PluginManager.closePluginView directly without
   * going through insertShape.
   */
  const handleOverlayPress = useCallback(async () => {
    if (insertingRef.current) {return;}
    insertingRef.current = true;
    setError(null);
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    try {
      await insertShape(selectedShape, style, pageWidth, pageHeight);
      PluginManager.closePluginView();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Insert failed';
      showError(message);
    } finally {
      insertingRef.current = false;
    }
  }, [selectedShape, style, pageWidth, pageHeight, showError]);

  return (
    <Pressable
      testID={TEST_IDS.overlay}
      style={styles.container}
      onPress={handleOverlayPress}>
      <Pressable
        style={[styles.panel, {width: PANEL_WIDTH}]}
        onPress={e => e.stopPropagation()}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Shapes</Text>
          <Pressable
            testID={TEST_IDS.closeButton}
            onPress={() => PluginManager.closePluginView()}
            style={({pressed}) => [styles.closeBtn, pressed && styles.closeBtnPressed]}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <View style={styles.divider} />

        {error && (
          <View testID={TEST_IDS.error} style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Hybrid grid body: Row 1 two-col (shapes + preview), then full-width picker rows. */}
        <View style={styles.body}>
          {/* Row 1 — shapes grid + preview side by side. */}
          <View style={styles.firstRow}>
            <View testID={TEST_IDS.shapesColumn} style={styles.shapesColumn}>
              {/* Carousel header: ‹  Group Label  › */}
              <View testID={TEST_IDS.groupHeader} style={styles.groupHeader}>
                <Pressable
                  testID={TEST_IDS.groupPrev}
                  onPress={() => cycleCategory(-1)}
                  hitSlop={8}
                  style={({pressed}) => [
                    styles.groupArrow,
                    pressed && styles.groupArrowPressed,
                  ]}>
                  <Text style={styles.groupArrowText}>◀</Text>
                </Pressable>
                <Text
                  testID={TEST_IDS.groupLabel}
                  style={styles.groupLabel}
                  numberOfLines={1}>
                  {CATEGORY_LABELS[selectedCategory]}
                </Text>
                <Pressable
                  testID={TEST_IDS.groupNext}
                  onPress={() => cycleCategory(1)}
                  hitSlop={8}
                  style={({pressed}) => [
                    styles.groupArrow,
                    pressed && styles.groupArrowPressed,
                  ]}>
                  <Text style={styles.groupArrowText}>▶</Text>
                </Pressable>
              </View>
              <ScrollView
                ref={gridScrollRef}
                style={styles.gridScroll}
                contentContainerStyle={styles.gridContainer}>
                <ShapeGrid
                  shapes={visibleShapes}
                  selectedId={selectedId}
                  onSelect={handleShapeTap}
                />
              </ScrollView>
            </View>

            <View testID={TEST_IDS.previewColumn} style={styles.previewColumn}>
              <StrokePreview
                shapeType={previewType}
                penWidth={style.penWidth}
                penColor={style.penColor}
                penType={style.penType}
                iconSource={previewIcon}
              />
            </View>
          </View>

          <View style={styles.divider} />

          {/* Row 2 — Stroke Width (full-width). v1.0.4 dropped the
              composite/sticker path, so every shape now honours this
              row — no per-shape "(fixed)" ghosting needed. */}
          <View testID={TEST_IDS.widthRow} style={styles.section}>
            <Text style={styles.sectionLabel}>Stroke Width</Text>
            <View style={styles.widthRow}>
              {WIDTH_PRESETS.map(p => {
                const selected = style.penWidth === p.value;
                return (
                  <Pressable
                    key={p.value}
                    testID={TEST_IDS.widthButton(p.value)}
                    onPress={() => handleWidthPress(p.value)}
                    style={({pressed}) => [
                      styles.widthBtn,
                      selected && styles.widthBtnSelected,
                      pressed && styles.widthBtnPressed,
                    ]}>
                    <View
                      style={[
                        styles.widthPreview,
                        {height: Math.max(2, Math.round(p.value / 100))},
                      ]}
                    />
                    <Text style={styles.widthLabel}>{p.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.divider} />

          {/* Row 3 — Stroke Color (full-width). */}
          <View testID={TEST_IDS.colorRow} style={styles.section}>
            <Text style={styles.sectionLabel}>Stroke Color</Text>
            <View style={styles.pickerRow}>
              {COLOR_PRESETS.map(c => {
                const selected = style.penColor === c.value;
                return (
                  <Pressable
                    key={c.value}
                    testID={TEST_IDS.colorButton(c.value)}
                    onPress={() => handleColorPress(c.value)}
                    style={({pressed}) => [
                      styles.colorBtn,
                      selected && styles.colorBtnSelected,
                      pressed && styles.colorBtnPressed,
                    ]}>
                    <View style={[styles.colorSwatch, {backgroundColor: c.swatch}]} />
                    <Text style={styles.colorLabel}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.divider} />

          {/* Centred tagline carried over from the contrib branch
              (2026-04-20). Non-interactive — purely a community wink. */}
          <Text testID={TEST_IDS.footer} style={styles.footer}>
            Made with ❤️ for those who write.
          </Text>
        </View>
      </Pressable>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// ShapeGrid sub-component
// ---------------------------------------------------------------------------

type ShapeGridProps = {
  shapes: readonly Shape[];
  selectedId: ShapeId;
  onSelect: (shape: Shape) => void;
};

function ShapeGrid({shapes, selectedId, onSelect}: ShapeGridProps) {
  // Slice into fixed-width rows so the grid renders deterministically even
  // if ScrollView chokes on flex-wrap on older RN versions.
  const rows: Shape[][] = [];
  for (let i = 0; i < shapes.length; i += GRID_COLS) {
    rows.push(shapes.slice(i, i + GRID_COLS));
  }
  return (
    <View>
      {rows.map((row, idx) => (
        <View key={idx} style={styles.gridRow}>
          {row.map(shape => {
            const isSelected = selectedId === shape.id;
            return (
              <Pressable
                key={shape.id}
                testID={TEST_IDS.cell(shape.id)}
                style={({pressed}) => [
                  styles.cell,
                  isSelected && styles.cellSelected,
                  pressed && styles.cellPressed,
                ]}
                onPress={() => onSelect(shape)}>
                <Image
                  source={SHAPE_ICONS[shape.id]}
                  style={styles.thumbnail}
                  resizeMode="contain"
                />
              </Pressable>
            );
          })}
          {/* Fill empty cells in the last row so sibling widths match. */}
          {row.length < GRID_COLS &&
            Array.from({length: GRID_COLS - row.length}).map((_, i) => (
              <View key={`filler-${i}`} style={styles.cellFiller} />
            ))}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    // `alignItems` is the cross axis for a row flex container, so this
    // vertically centers the panel inside the full-page overlay. Prior
    // to 2026-04-20 the panel was pinned near the top (`top: '2%'`,
    // `alignItems: 'flex-start'`) which looked correct on Nomad but
    // stranded the panel well above the puzzle-piece plugin icon on
    // Manta. Centering gets us close to the icon's Y on both form
    // factors without the SDK needing to expose the button rect.
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  panel: {
    // Horizontally anchored alongside the left toolbar so it reads as
    // "attached to" the Plugins icon rather than floating in space.
    // Vertical position comes from the container's alignItems above.
    marginLeft: 90,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#000000',
    overflow: 'visible',
    paddingBottom: PANEL_PADDING,
  },
  headerRow: {
    paddingHorizontal: PANEL_PADDING,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000000',
  },
  closeBtn: {
    position: 'absolute',
    right: PANEL_PADDING,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnPressed: {
    backgroundColor: '#F0F0F0',
  },
  closeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#000000',
  },
  divider: {
    height: 1,
    backgroundColor: '#CCCCCC',
  },
  errorBanner: {
    marginHorizontal: PANEL_PADDING,
    marginTop: 5,
    backgroundColor: '#1A1A1A',
    borderRadius: 3,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: 12,
    textAlign: 'center',
  },
  body: {
    paddingHorizontal: PANEL_PADDING,
    paddingTop: 5,
  },
  firstRow: {
    flexDirection: 'row',
    gap: ROW1_GAP,
    marginBottom: 5,
  },
  shapesColumn: {
    width: SHAPES_COLUMN_WIDTH,
  },
  // Carousel header (◀  Group Label  ▶) sits above the shapes grid in
  // the shapes column. Per user feedback 2026-04-20 the earlier bordered
  // circle around each arrow is dropped: the filled-triangle glyph itself
  // reads as an affordance, and the circle's border competed with a
  // glyph whose ink bounds are not symmetric around its advance-width —
  // which meant a visibly off-centre triangle inside the circle on e-ink.
  // Tap area is preserved via hitSlop; the glyph font size is bumped so
  // the bare triangle still reads at arm's length.
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 28,
    marginBottom: 4,
  },
  groupArrow: {
    // No border / background / fixed frame: the triangle glyph is the
    // affordance. A small padding block keeps the Pressable press-state
    // visible without shifting the triangle off the row's vertical axis.
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupArrowPressed: {
    // Subtle grey flash so taps register on e-ink (which compresses the
    // upper-grey range). No circle means no border to colour-invert, so
    // a background fill is the only press affordance available.
    backgroundColor: '#D8D8D8',
    borderRadius: 4,
  },
  groupArrowText: {
    // Bumped from 14 → 20 now that the triangle stands alone. At 20 px
    // the glyph reads as a chunky arrowhead comparable to the prior
    // 32 px circle's overall silhouette, without the centring quirks of
    // nesting a glyph inside a round border.
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000000',
  },
  groupLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
    color: '#000000',
  },
  previewColumn: {
    width: PREVIEW_COLUMN_WIDTH,
    // Subtle divider-like border on the leading edge helps separate the
    // two columns without needing a full-height <View style={divider}/>.
    borderLeftWidth: 1,
    borderLeftColor: '#CCCCCC',
    paddingLeft: ROW1_GAP,
  },
  // Fixed grid height so the panel footprint stays constant as the user
  // cycles categories — the `height` is derived from the largest
  // category via GRID_HEIGHT_PX so this block stays correct when shapes
  // are added or removed. Rationale for the fixed-height approach (vs
  // maxHeight) in the GRID_HEIGHT_PX doc comment above.
  gridScroll: {
    height: GRID_HEIGHT_PX,
  },
  gridContainer: {
    paddingVertical: 2,
  },
  gridRow: {
    flexDirection: 'row',
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderWidth: 1,
    borderColor: '#CCCCCC',
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  cellSelected: {
    borderColor: '#000000',
    borderWidth: 2,
    backgroundColor: '#F0F0F0',
  },
  cellPressed: {
    backgroundColor: '#E8E8E8',
  },
  cellFiller: {
    width: CELL_SIZE,
    height: CELL_SIZE,
  },
  thumbnail: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
  },
  section: {
    paddingTop: 6,
    paddingBottom: 2,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 4,
  },
  pickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  widthRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 2,
  },
  widthBtn: {
    flex: 1,
    paddingVertical: 4,
    paddingHorizontal: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#CCCCCC',
    gap: 2,
  },
  widthBtnSelected: {
    borderColor: '#000000',
    borderWidth: 2,
  },
  widthBtnPressed: {
    backgroundColor: '#F0F0F0',
  },
  widthPreview: {
    width: 14,
    backgroundColor: '#000000',
    borderRadius: 1,
  },
  widthLabel: {
    fontSize: 11,
    color: '#000000',
    fontWeight: '600',
  },
  colorBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#CCCCCC',
    gap: 3,
  },
  colorBtnSelected: {
    borderColor: '#000000',
    borderWidth: 2,
  },
  colorBtnPressed: {
    backgroundColor: '#F0F0F0',
  },
  colorSwatch: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#000000',
  },
  colorLabel: {
    fontSize: 11,
    color: '#000000',
    fontWeight: '600',
  },
  // Centred tagline sitting below the pickers. Muted grey + small size so
  // it doesn't compete with the interactive rows for attention — reads as
  // a signature, not a button. Padding matches the panel's rhythm
  // (PANEL_PADDING) so it aligns with the content columns above.
  footer: {
    textAlign: 'center',
    fontSize: 10,
    color: '#555555',
    paddingTop: 8,
    paddingHorizontal: PANEL_PADDING,
  },
});
