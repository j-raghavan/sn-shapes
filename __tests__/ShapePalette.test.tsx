import React from 'react';
import {create, act, ReactTestRenderer} from 'react-test-renderer';
import {PixelRatio, Pressable, Text} from 'react-native';

jest.mock('sn-plugin-lib', () => {
  return {
    PluginCommAPI: {
      insertGeometry: jest.fn().mockResolvedValue({success: true}),
      getCurrentFilePath: jest.fn().mockResolvedValue({success: true, result: '/note/test.note'}),
      getCurrentPageNum: jest.fn().mockResolvedValue({success: true, result: 0}),
    },
    PluginFileAPI: {
      getPageSize: jest.fn().mockResolvedValue({success: true, result: {width: 1404, height: 1872}}),
    },
    PluginManager: {
      closePluginView: jest.fn().mockResolvedValue(true),
    },
  };
});

import ShapePalette, {
  TEST_IDS,
  DEFAULT_PAGE_WIDTH,
  SHAPE_ICONS,
} from '../src/ShapePalette';
import {
  SHAPES,
  ShapeId,
  ShapeCategory,
  PEN_DEFAULTS,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  shapesInCategory,
  nextCategory,
  WIDTH_PRESETS,
  COLOR_PRESETS,
  MAX_FAVORITES,
} from '../src/shapes';
import {
  FavoritesStorage,
  createMemoryFavoritesStorage,
} from '../src/favoritesStorage';
import {TEST_IDS as PREVIEW_TEST_IDS} from '../src/StrokePreview';
import {
  PluginCommAPI,
  PluginFileAPI,
  PluginManager,
} from 'sn-plugin-lib';

function flushPromises() {
  return new Promise(resolve =>
    jest.requireActual<typeof globalThis>('timers').setImmediate(resolve)
  );
}

function findByTestID(tree: ReactTestRenderer, testID: string) {
  return tree.root.findByProps({testID});
}

/**
 * Every cell currently visible in the grid. Since v1.0.4 the grid only
 * renders shapes in the active category; basic is the landing category
 * so this resolves to every Basic shape on mount.
 */
function findAllCells(tree: ReactTestRenderer) {
  return shapesInCategory('basic').map(s =>
    findByTestID(tree, TEST_IDS.cell(s.id)),
  );
}

let consoleErrorSpy: jest.SpyInstance;
let consoleWarnSpy: jest.SpyInstance;
// insertShape logs the firmware verdict for logcat; keep jest output clean.
let consoleLogSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  (PluginCommAPI.insertGeometry as jest.Mock).mockClear();
  (PluginCommAPI.getCurrentFilePath as jest.Mock).mockClear();
  (PluginCommAPI.getCurrentPageNum as jest.Mock).mockClear();
  (PluginFileAPI.getPageSize as jest.Mock).mockClear();
  (PluginManager.closePluginView as jest.Mock).mockClear();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  consoleLogSpy.mockRestore();
});

// Helper: render the palette and let mount-time async work settle.
// Accepts an optional pre-seeded favorites storage so individual tests
// can land in "user already has favorites X, Y" without driving the
// heart toggle through the UI first. When omitted, every mount uses a
// fresh memory backend so favorites state never leaks between tests.
async function mountPalette(storage?: FavoritesStorage) {
  const injectedStorage = storage ?? createMemoryFavoritesStorage();
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(<ShapePalette storage={injectedStorage} />);
  });
  await act(async () => {
    await flushPromises();
    await flushPromises();
  });
  return tree!;
}

// Overlay gesture helpers (issue #15). The overlay is a responder View:
// pen-down (grant) + pen-up (release) at the same point is a tap; a
// release far from the grant is a drag. Events carry root-relative dp.
type Pt = {x: number; y: number};
const TAP_POINT: Pt = {x: 702, y: 936};
// ShapePalette captures PixelRatio.get() at module load (TOUCH_SCALE);
// under the jest react-native preset that is 2. Expectations below are
// written in terms of it so they hold whatever the preset reports.
const SCALE = PixelRatio.get();
const px = (v: number) => v * SCALE;
function touchEvent(p: Pt) {
  return {nativeEvent: {pageX: p.x, pageY: p.y}};
}
function overlayProps(tree: ReactTestRenderer) {
  return findByTestID(tree, TEST_IDS.overlay).props;
}
// Synchronous grant+release, for tests that want the insert in flight.
function tapOverlay(tree: ReactTestRenderer, down: Pt = TAP_POINT, up: Pt = down) {
  const o = overlayProps(tree);
  o.onResponderGrant(touchEvent(down));
  return o.onResponderRelease(touchEvent(up));
}

// Helper: pen down + up outside the panel — the overlay gesture is the
// commit-and-close affordance (the explicit Insert button was dropped
// 2026-04-18). The release handler is async (awaits insertShape) so we
// flush a few microtask ticks to let the promise chain settle.
async function pressInsert(tree: ReactTestRenderer, down: Pt = TAP_POINT, up: Pt = down) {
  await act(async () => {
    await tapOverlay(tree, down, up);
    await flushPromises();
    await flushPromises();
    await flushPromises();
  });
}

// Helper: select a shape by id (no insert).
async function selectShape(tree: ReactTestRenderer, id: ShapeId) {
  await act(async () => {
    findByTestID(tree, TEST_IDS.cell(id)).props.onPress();
    await flushPromises();
  });
}

describe('ShapePalette (merged popup)', () => {
  it('renders without crashing', async () => {
    const tree = await mountPalette();
    expect(tree.toJSON()).toBeTruthy();
  });

  it('renders a cell for every shape in the landing (basic) category', async () => {
    const tree = await mountPalette();
    const basicCount = shapesInCategory('basic').length;
    expect(findAllCells(tree)).toHaveLength(basicCount);
  });

  it('does NOT render cells for shapes outside the active category', async () => {
    // Since SHAPES may host more groups than just 'basic', shapes in
    // other categories must be absent from the initial (basic) grid. We
    // pick the first non-basic shape (if any) and assert it has no cell.
    const tree = await mountPalette();
    const foreign = SHAPES.find(s => {
      const cats = Array.isArray(s.category) ? s.category : [s.category];
      return !cats.includes('basic');
    });
    if (!foreign) {return;}  // no other categories yet — assertion vacuous
    expect(() => findByTestID(tree, TEST_IDS.cell(foreign.id))).toThrow();
  });

  it('does NOT render a dedicated Insert button (overlay-to-commit design)', async () => {
    // The Insert button was dropped 2026-04-18 — tapping outside the
    // panel commits the current selection. The old testID is gone and
    // the shipped tree must not contain it under any other name.
    const tree = await mountPalette();
    expect(() => findByTestID(tree, 'shapes-insert-button')).toThrow();
  });

  it('renders a width button for every WIDTH_PRESETS entry', async () => {
    const tree = await mountPalette();
    WIDTH_PRESETS.forEach(p => {
      expect(findByTestID(tree, TEST_IDS.widthButton(p.value))).toBeTruthy();
    });
  });

  it('renders a color button for every COLOR_PRESETS entry', async () => {
    const tree = await mountPalette();
    COLOR_PRESETS.forEach(c => {
      expect(findByTestID(tree, TEST_IDS.colorButton(c.value))).toBeTruthy();
    });
  });

  it('does NOT render a Pen Type row (dropped 2026-04-18)', async () => {
    // Pen type is set in the firmware's main UI; duplicating it inside
    // the Shapes popup was redundant. Regression guard: no old testIDs
    // must leak back in under the hybrid-grid layout.
    const tree = await mountPalette();
    expect(() => findByTestID(tree, 'shapes-pentype-row')).toThrow();
    for (const value of [1, 10, 11, 14]) {
      expect(() => findByTestID(tree, `shapes-pentype-${value}`)).toThrow();
    }
  });

  it('exposes only XS/S/M/L/XL as width presets', () => {
    // Regression guard: we collapsed from 9 → 5 presets (2026-04-18).
    // If anyone re-expands WIDTH_PRESETS without updating the label
    // field, this test catches it.
    expect(WIDTH_PRESETS).toHaveLength(5);
    expect(WIDTH_PRESETS.map(p => p.label)).toEqual(['XS', 'S', 'M', 'L', 'XL']);
  });

  it('ships a PNG icon for every shape in SHAPES', () => {
    // SHAPE_ICONS is typed Record<ShapeId, ImageSourcePropType> (no
    // Partial), so TypeScript would already flag a missing icon — but
    // we also cover it at runtime to catch accidental assignment of
    // `undefined` through a type assertion.
    SHAPES.forEach(s => {
      expect(SHAPE_ICONS[s.id]).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Hybrid grid layout: Row 1 two-col (shapes + preview); Rows 2-4 full-width.
  // -------------------------------------------------------------------------
  it('renders shapes and preview in Row 1, and full-width rows below', async () => {
    const tree = await mountPalette();
    // Row 1 columns.
    expect(findByTestID(tree, TEST_IDS.shapesColumn)).toBeTruthy();
    expect(findByTestID(tree, TEST_IDS.previewColumn)).toBeTruthy();
    // Rows 2-3 (Pen Type row was dropped 2026-04-18).
    expect(findByTestID(tree, TEST_IDS.widthRow)).toBeTruthy();
    expect(findByTestID(tree, TEST_IDS.colorRow)).toBeTruthy();
  });

  it('places the StrokePreview in the preview column of Row 1', async () => {
    const tree = await mountPalette();
    // findAllByProps returns both the host node and the composite
    // component instance, so >=1 is the meaningful assertion.
    const previewCol = findByTestID(tree, TEST_IDS.previewColumn);
    const descendants = previewCol.findAllByProps({testID: PREVIEW_TEST_IDS.container});
    expect(descendants.length).toBeGreaterThanOrEqual(1);
    // And the shapes column must NOT contain the preview.
    const shapesCol = findByTestID(tree, TEST_IDS.shapesColumn);
    expect(shapesCol.findAllByProps({testID: PREVIEW_TEST_IDS.container})).toHaveLength(0);
  });

  it('places the shape cells inside the shapes column (not the preview column)', async () => {
    const tree = await mountPalette();
    const shapesCol = findByTestID(tree, TEST_IDS.shapesColumn);
    // Since v1.0.4 the grid only renders shapes in the active category,
    // so we scope the assertion to the Basic category (the landing tab).
    for (const s of shapesInCategory('basic')) {
      expect(
        shapesCol.findAllByProps({testID: TEST_IDS.cell(s.id)}).length,
      ).toBeGreaterThanOrEqual(1);
    }
    const previewCol = findByTestID(tree, TEST_IDS.previewColumn);
    // Preview column must not contain any shape cells.
    for (const s of shapesInCategory('basic')) {
      expect(
        previewCol.findAllByProps({testID: TEST_IDS.cell(s.id)}),
      ).toHaveLength(0);
    }
  });

  it('places the width / color rows outside the Row 1 columns', async () => {
    const tree = await mountPalette();
    // The picker rows are siblings of Row 1, not descendants. Confirm
    // by asserting neither Row 1 column contains them.
    const shapesCol = findByTestID(tree, TEST_IDS.shapesColumn);
    const previewCol = findByTestID(tree, TEST_IDS.previewColumn);
    for (const rowTestID of [TEST_IDS.widthRow, TEST_IDS.colorRow]) {
      expect(shapesCol.findAllByProps({testID: rowTestID})).toHaveLength(0);
      expect(previewCol.findAllByProps({testID: rowTestID})).toHaveLength(0);
    }
  });

  // -------------------------------------------------------------------------
  // Preview
  // -------------------------------------------------------------------------
  it('renders the StrokePreview with the static "Preview" header', async () => {
    const tree = await mountPalette();
    expect(findByTestID(tree, PREVIEW_TEST_IDS.container)).toBeTruthy();
    // Header is a static "Preview" string — no more per-shape labelling.
    expect(findByTestID(tree, PREVIEW_TEST_IDS.shapeName).props.children).toBe(
      'Preview',
    );
  });

  it('passes the selected shape\'s icon to StrokePreview', async () => {
    const tree = await mountPalette();
    // Default selection is rectangle.
    const rectIcon = findByTestID(tree, PREVIEW_TEST_IDS.icon);
    expect(rectIcon.props.source).toBe(SHAPE_ICONS.rectangle);

    await selectShape(tree, 'pentagon');
    const pentIcon = findByTestID(tree, PREVIEW_TEST_IDS.icon);
    expect(pentIcon.props.source).toBe(SHAPE_ICONS.pentagon);

    await selectShape(tree, 'parallelogram');
    const paraIcon = findByTestID(tree, PREVIEW_TEST_IDS.icon);
    expect(paraIcon.props.source).toBe(SHAPE_ICONS.parallelogram);
  });

  it('updates the stroke-width sample bar when a Stroke Width preset is tapped', async () => {
    // The PNG icon can't be thickened by tintColor, so the preview grows
    // the dedicated stroke-sample bar. Regression guard for the
    // 2026-04-18 bug where width changes didn't reflect in the preview.
    const tree = await mountPalette();
    // Default style lands on M (500 µm); start by picking XS so we have
    // a clear "thin" baseline, then jump to XL and watch the bar grow.
    await act(async () => {
      findByTestID(tree, TEST_IDS.widthButton(100)).props.onPress();
      await flushPromises();
    });
    const before = findByTestID(tree, PREVIEW_TEST_IDS.strokeSample);
    const beforeStyle = Object.assign(
      {},
      ...[before.props.style].flat(Infinity).filter(Boolean),
    );

    await act(async () => {
      findByTestID(tree, TEST_IDS.widthButton(900)).props.onPress();
      await flushPromises();
    });

    const after = findByTestID(tree, PREVIEW_TEST_IDS.strokeSample);
    const afterStyle = Object.assign(
      {},
      ...[after.props.style].flat(Infinity).filter(Boolean),
    );
    // XL must render thicker than XS (penWidthToPreviewPx: 100 → 3 px,
    // 900 → 23 px).
    expect(afterStyle.height as number).toBeGreaterThan(beforeStyle.height as number);
  });

  // -------------------------------------------------------------------------
  // Two-step commit behaviour
  // -------------------------------------------------------------------------
  it('does NOT insert when a shape cell is tapped', async () => {
    const tree = await mountPalette();
    await selectShape(tree, 'circle');
    expect(PluginCommAPI.insertGeometry).not.toHaveBeenCalled();
    expect(PluginManager.closePluginView).not.toHaveBeenCalled();
  });

  it('does NOT insert when a picker option is tapped', async () => {
    // Tapping a width / colour preset updates pendingStyle only — no
    // geometry fires until the overlay is tapped.
    const tree = await mountPalette();
    await act(async () => {
      findByTestID(tree, TEST_IDS.widthButton(700)).props.onPress();
      findByTestID(tree, TEST_IDS.colorButton(0xC9)).props.onPress();
      await flushPromises();
    });
    expect(PluginCommAPI.insertGeometry).not.toHaveBeenCalled();
    expect(PluginManager.closePluginView).not.toHaveBeenCalled();
  });

  it('inserts the currently-selected shape when the overlay is tapped', async () => {
    const tree = await mountPalette();
    await selectShape(tree, 'circle');
    await pressInsert(tree);
    expect(PluginCommAPI.insertGeometry).toHaveBeenCalledTimes(1);
    const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
    expect(geo.type).toBe('GEO_circle');
  });

  it('closes plugin view after a successful overlay-commit', async () => {
    const tree = await mountPalette();
    await pressInsert(tree);
    expect(PluginManager.closePluginView).toHaveBeenCalled();
  });

  it('uses the picked stroke width / color at commit time', async () => {
    const tree = await mountPalette();
    await selectShape(tree, 'rectangle');
    await act(async () => {
      findByTestID(tree, TEST_IDS.widthButton(700)).props.onPress();
      findByTestID(tree, TEST_IDS.colorButton(0xC9)).props.onPress();
      await flushPromises();
    });
    await pressInsert(tree);
    const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
    expect(geo.penWidth).toBe(700);
    expect(geo.penColor).toBe(0xC9);
    // Pen type is no longer user-selectable here — inserted geometry
    // carries PEN_DEFAULTS.penType so the firmware accepts it.
    expect(geo.penType).toBe(PEN_DEFAULTS.penType);
  });

  it('auto-lassoes a single-primitive shape after insert', async () => {
    // Single-primitive shapes (rectangle, circle, polygon, …) contain the
    // entire shape in one Geometry, so auto-lassoing matches user intent.
    const tree = await mountPalette();
    await selectShape(tree, 'rectangle');
    await pressInsert(tree);
    const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
    expect(geo.showLassoAfterInsert).toBe(true);
  });

  it('inserts every shape exclusively through insertGeometry (no bitmap path)', async () => {
    // v1.0.4 regression guard: the composite/bitmap path was removed.
    // Every shape — including the post-v1.0.3 additions in non-Basic
    // categories — now authors a single Geometry and commits through
    // insertGeometry. A future accidental re-introduction of a
    // multi-geometry composite would show up here as the insert count
    // going below SHAPES.length (commits silently dropped) or as an
    // extra reference to a bitmap-API mock that no longer exists.
    //
    // 'favorites' is excluded from the walk: its membership is
    // user-driven (no static representative) and the insert path is
    // identical to whichever shape happens to be favorited.
    // Walk every NON-EMPTY static category (favorites excluded — its
    // membership is user-driven). A static category may legitimately be
    // empty during a phased rollout (e.g. the 'threeD' group exists in
    // CATEGORY_ORDER before its shapes land), so we skip empties rather
    // than dereference a missing representative; the carousel itself does
    // not skip empty groups, so navigation distance is measured against
    // the full CATEGORY_ORDER position.
    const tree = await mountPalette();
    const LANDING = 'basic';
    const landingIdx = CATEGORY_ORDER.indexOf(LANDING);
    const targets = CATEGORY_ORDER.map((c, idx) => ({c, idx}))
      .filter(({c}) => c !== 'favorites' && shapesInCategory(c).length > 0)
      .map(({c, idx}) => ({id: shapesInCategory(c)[0].id, steps: idx - landingIdx}));
    for (const {id, steps} of targets) {
      for (let j = 0; j < steps; j++) {
        await act(async () => {
          findByTestID(tree, TEST_IDS.groupNext).props.onPress();
          await flushPromises();
        });
      }
      await selectShape(tree, id);
      await pressInsert(tree);
      for (let j = 0; j < steps; j++) {
        await act(async () => {
          findByTestID(tree, TEST_IDS.groupPrev).props.onPress();
          await flushPromises();
        });
      }
    }
    expect(PluginCommAPI.insertGeometry).toHaveBeenCalledTimes(targets.length);
  });

  // -------------------------------------------------------------------------
  // Close affordance — ✕ cancels without inserting
  // -------------------------------------------------------------------------
  it('the header ✕ closes WITHOUT inserting (explicit cancel)', async () => {
    // The overlay commits; the ✕ button is the explicit cancel path.
    // Must NOT call insertGeometry even when a selection + style are
    // pending — users need a way to back out without committing.
    const tree = await mountPalette();
    await selectShape(tree, 'pentagon');
    await act(async () => {
      findByTestID(tree, TEST_IDS.widthButton(700)).props.onPress();
      await flushPromises();
    });
    await act(async () => {
      findByTestID(tree, TEST_IDS.closeButton).props.onPress();
      await flushPromises();
    });
    expect(PluginManager.closePluginView).toHaveBeenCalled();
    expect(PluginCommAPI.insertGeometry).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Page-context resolution
  // -------------------------------------------------------------------------
  // A tap far past the right edge is clamped so the shape's right edge
  // lands exactly on the resolved page width — which is how we prove the
  // resolved size (not the default) drove placement.
  const FAR_RIGHT = {x: 100000, y: 936};

  it('clamps the inserted shape to the resolved page size', async () => {
    (PluginCommAPI.getCurrentFilePath as jest.Mock).mockResolvedValueOnce({
      success: true,
      result: '/note/my.note',
    });
    (PluginCommAPI.getCurrentPageNum as jest.Mock).mockResolvedValueOnce({
      success: true,
      result: 3,
    });
    (PluginFileAPI.getPageSize as jest.Mock).mockResolvedValueOnce({
      success: true,
      result: {width: 1920, height: 2560},
    });
    const tree = await mountPalette();
    await pressInsert(tree, FAR_RIGHT);
    expect(PluginFileAPI.getPageSize).toHaveBeenCalledWith('/note/my.note', 3);
    const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
    const xs = geo.points.map((p: {x: number}) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(1920, 6);
  });

  it('falls back to default page width when getCurrentFilePath fails', async () => {
    (PluginCommAPI.getCurrentFilePath as jest.Mock).mockRejectedValueOnce(
      new Error('unavailable'),
    );
    const tree = await mountPalette();
    await pressInsert(tree, FAR_RIGHT);
    expect(PluginFileAPI.getPageSize).not.toHaveBeenCalled();
    const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
    const xs = geo.points.map((p: {x: number}) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(DEFAULT_PAGE_WIDTH, 6);
  });

  it('falls back to default page width when getPageSize fails', async () => {
    (PluginFileAPI.getPageSize as jest.Mock).mockRejectedValueOnce(
      new Error('unavailable'),
    );
    const tree = await mountPalette();
    await pressInsert(tree, FAR_RIGHT);
    const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
    const xs = geo.points.map((p: {x: number}) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(DEFAULT_PAGE_WIDTH, 6);
  });

  it('falls back to default page width when getCurrentFilePath resolves unsuccessfully (not rejected)', async () => {
    (PluginCommAPI.getCurrentFilePath as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: {message: 'no file open'},
    });
    const tree = await mountPalette();
    await pressInsert(tree, FAR_RIGHT);
    expect(PluginFileAPI.getPageSize).not.toHaveBeenCalled();
    const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
    const xs = geo.points.map((p: {x: number}) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(DEFAULT_PAGE_WIDTH, 6);
  });

  it('falls back to default page width when getPageSize resolves unsuccessfully (not rejected)', async () => {
    (PluginFileAPI.getPageSize as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: {message: 'bad page'},
    });
    const tree = await mountPalette();
    await pressInsert(tree, FAR_RIGHT);
    const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
    const xs = geo.points.map((p: {x: number}) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(DEFAULT_PAGE_WIDTH, 6);
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------
  it('shows error banner and stays open when insert fails', async () => {
    (PluginCommAPI.insertGeometry as jest.Mock).mockRejectedValueOnce(
      new Error('boom'),
    );
    const tree = await mountPalette();
    await pressInsert(tree);
    expect(PluginManager.closePluginView).not.toHaveBeenCalled();
    const banner = findByTestID(tree, TEST_IDS.error);
    expect(banner).toBeTruthy();
  });

  it('clears error banner on successful retry', async () => {
    (PluginCommAPI.insertGeometry as jest.Mock).mockRejectedValueOnce(
      new Error('boom'),
    );
    const tree = await mountPalette();
    await pressInsert(tree);
    expect(findByTestID(tree, TEST_IDS.error)).toBeTruthy();

    (PluginCommAPI.insertGeometry as jest.Mock).mockResolvedValueOnce({success: true});
    await pressInsert(tree);
    expect(() => findByTestID(tree, TEST_IDS.error)).toThrow();
  });

  it('auto-dismisses error banner after timeout', async () => {
    (PluginCommAPI.insertGeometry as jest.Mock).mockRejectedValueOnce(
      new Error('boom'),
    );
    const tree = await mountPalette();
    await pressInsert(tree);
    expect(() => findByTestID(tree, TEST_IDS.error)).not.toThrow();
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(() => findByTestID(tree, TEST_IDS.error)).toThrow();
  });

  // -------------------------------------------------------------------------
  // Carousel group navigation (v1.0.4)
  // -------------------------------------------------------------------------
  async function tapGroupNext(tree: ReactTestRenderer) {
    await act(async () => {
      findByTestID(tree, TEST_IDS.groupNext).props.onPress();
      await flushPromises();
    });
  }
  async function tapGroupPrev(tree: ReactTestRenderer) {
    await act(async () => {
      findByTestID(tree, TEST_IDS.groupPrev).props.onPress();
      await flushPromises();
    });
  }

  it('renders the group carousel header with prev / next arrows and a label', async () => {
    const tree = await mountPalette();
    expect(findByTestID(tree, TEST_IDS.groupHeader)).toBeTruthy();
    expect(findByTestID(tree, TEST_IDS.groupPrev)).toBeTruthy();
    expect(findByTestID(tree, TEST_IDS.groupNext)).toBeTruthy();
    // Lands on the Basic group by default — label text must match.
    expect(findByTestID(tree, TEST_IDS.groupLabel).props.children).toBe(
      CATEGORY_LABELS.basic,
    );
  });

  it('next arrow advances the label through CATEGORY_ORDER (with wrap)', async () => {
    const tree = await mountPalette();
    let current: ShapeCategory = 'basic';
    // Walk the full cycle; after N taps we must land on the starting label.
    for (let i = 0; i < CATEGORY_ORDER.length; i++) {
      await tapGroupNext(tree);
      current = nextCategory(current, 1);
      expect(findByTestID(tree, TEST_IDS.groupLabel).props.children).toBe(
        CATEGORY_LABELS[current],
      );
    }
    expect(findByTestID(tree, TEST_IDS.groupLabel).props.children).toBe(
      CATEGORY_LABELS.basic,
    );
  });

  it('prev arrow from the landing group steps to the previous category', async () => {
    // Landing category is 'basic'; walking ◀ once must land on the
    // category that immediately precedes it in CATEGORY_ORDER. The
    // exact value depends on CATEGORY_ORDER (currently 'favorites'),
    // so the test derives it via nextCategory rather than hard-coding
    // — keeps the test resilient to future reorders.
    const tree = await mountPalette();
    await tapGroupPrev(tree);
    const prev = nextCategory('basic', -1);
    expect(findByTestID(tree, TEST_IDS.groupLabel).props.children).toBe(
      CATEGORY_LABELS[prev],
    );
  });

  it('navigation does NOT trigger an insertGeometry call', async () => {
    // Regression: cycling groups is a pure-UI action and must not touch
    // the firmware. Overlay taps still commit, but arrow taps don't.
    const tree = await mountPalette();
    await tapGroupNext(tree);
    await tapGroupPrev(tree);
    await tapGroupNext(tree);
    expect(PluginCommAPI.insertGeometry).not.toHaveBeenCalled();
  });

  it('ignores group-nav taps while an insert is in flight', async () => {
    // Parity with other handlers: once commit is underway, UI is frozen.
    let resolveInsert: () => void;
    (PluginCommAPI.insertGeometry as jest.Mock).mockImplementationOnce(
      () => new Promise<void>(r => { resolveInsert = r; }),
    );
    const tree = await mountPalette();

    act(() => {
      tapOverlay(tree);
    });
    await act(async () => {
      await flushPromises();
    });

    // Attempted group advance during in-flight commit — must be a no-op.
    await tapGroupNext(tree);
    expect(findByTestID(tree, TEST_IDS.groupLabel).props.children).toBe(
      CATEGORY_LABELS.basic,
    );

    await act(async () => {
      if (resolveInsert) {resolveInsert();}
      await flushPromises();
    });
  });

  // -------------------------------------------------------------------------
  // Favorites (v1.0.5)
  // -------------------------------------------------------------------------
  // The heart toggle lives in the preview column (single hit-target,
  // larger affordance than per-cell stars). Persistence is exercised
  // via the injected memory backend so each test is deterministic.
  async function tapFavorite(tree: ReactTestRenderer) {
    await act(async () => {
      findByTestID(tree, TEST_IDS.favoriteToggle).props.onPress();
      await flushPromises();
    });
  }

  // Walk the carousel until the requested category is active. Used by
  // the favorites tests to inspect the favorites grid without having
  // to know the prev/next direction by hand.
  async function navigateToCategory(
    tree: ReactTestRenderer,
    target: ShapeCategory,
  ) {
    // CATEGORY_ORDER + landing 'basic' make any target reachable via
    // ◀-only navigation in at most CATEGORY_ORDER.length steps.
    for (let i = 0; i < CATEGORY_ORDER.length; i++) {
      if (
        findByTestID(tree, TEST_IDS.groupLabel).props.children ===
        CATEGORY_LABELS[target]
      ) {
        return;
      }
      await act(async () => {
        findByTestID(tree, TEST_IDS.groupPrev).props.onPress();
        await flushPromises();
      });
    }
    throw new Error(`navigateToCategory: ${target} not reached`);
  }

  it('renders the heart toggle inside the preview column', async () => {
    const tree = await mountPalette();
    expect(findByTestID(tree, TEST_IDS.favoriteToggle)).toBeTruthy();
    const previewCol = findByTestID(tree, TEST_IDS.previewColumn);
    expect(
      previewCol.findAllByProps({testID: TEST_IDS.favoriteToggle}).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('shows ♡ for an unfavorited shape and ❤ once toggled', async () => {
    const tree = await mountPalette();
    // The Text child of the Pressable carries the icon glyph; walk
    // children rather than relying on the Pressable's own `children`
    // (which is the React element tree, not a string).
    const readGlyph = () =>
      findByTestID(tree, TEST_IDS.favoriteToggle).findByType('Text' as never)
        .props.children;
    expect(readGlyph()).toBe('♡');
    await tapFavorite(tree);
    expect(readGlyph()).toBe('❤');
  });

  it('Favorites category shows the empty placeholder when no shapes are favorited', async () => {
    const tree = await mountPalette();
    await navigateToCategory(tree, 'favorites');
    expect(findByTestID(tree, TEST_IDS.favoritesEmpty)).toBeTruthy();
  });

  it('toggling the heart adds the selected shape to the Favorites grid', async () => {
    const tree = await mountPalette();
    // Default selection is rectangle. Heart it, then walk to favorites.
    await tapFavorite(tree);
    await navigateToCategory(tree, 'favorites');
    expect(() => findByTestID(tree, TEST_IDS.cell('rectangle'))).not.toThrow();
    expect(() => findByTestID(tree, TEST_IDS.favoritesEmpty)).toThrow();
  });

  it('hydrates favorites from injected storage on mount', async () => {
    const seeded = createMemoryFavoritesStorage(['circle', 'pentagon']);
    const tree = await mountPalette(seeded);
    await navigateToCategory(tree, 'favorites');
    expect(() => findByTestID(tree, TEST_IDS.cell('circle'))).not.toThrow();
    expect(() => findByTestID(tree, TEST_IDS.cell('pentagon'))).not.toThrow();
  });

  it('persists changes through the storage backend', async () => {
    const seeded = createMemoryFavoritesStorage();
    const tree = await mountPalette(seeded);
    await selectShape(tree, 'pentagon');
    await tapFavorite(tree);
    // Drain microtasks so the save effect resolves.
    await act(async () => {
      await flushPromises();
    });
    expect(await seeded.load()).toEqual(['pentagon']);
  });

  it('hearting twice removes the shape (idempotent toggle)', async () => {
    const tree = await mountPalette();
    await selectShape(tree, 'circle');
    await tapFavorite(tree);
    await tapFavorite(tree);
    await navigateToCategory(tree, 'favorites');
    expect(findByTestID(tree, TEST_IDS.favoritesEmpty)).toBeTruthy();
  });

  it('Favorites grid preserves "most recent first" ordering', async () => {
    // Heart rectangle, then pentagon, then triangle. Favorites grid
    // must show triangle, pentagon, rectangle — matching the
    // addFavorite contract pinned in shapes.test.ts. Asserts the
    // RENDER ORDER of cells inside the grid scroll view, not just
    // their existence — a reversed-order regression has to fail here.
    const tree = await mountPalette();
    await selectShape(tree, 'rectangle');
    await tapFavorite(tree);
    await selectShape(tree, 'pentagon');
    await tapFavorite(tree);
    await selectShape(tree, 'triangle');
    await tapFavorite(tree);
    await navigateToCategory(tree, 'favorites');
    const shapesCol = findByTestID(tree, TEST_IDS.shapesColumn);
    // findAll returns one match per node in the rendered tree — for a
    // single Pressable cell that includes the composite element, the
    // host primitive, and any wrappers. Dedupe by testID so we get one
    // entry per cell, in render order.
    const seen = new Set<string>();
    const renderedFavorites: string[] = [];
    for (const node of shapesCol.findAll(
      n =>
        typeof n.props?.testID === 'string' &&
        n.props.testID.startsWith('shape-cell-'),
    )) {
      const id = (node.props.testID as string).replace('shape-cell-', '');
      if (!seen.has(id)) {
        seen.add(id);
        renderedFavorites.push(id);
      }
    }
    expect(renderedFavorites).toEqual(['triangle', 'pentagon', 'rectangle']);
  });

  it('drops orphan ids on hydration (shape removed in a later release)', async () => {
    // Spec §5.2: a future shape removal must auto-clean the user's
    // list so cap accounting and grid render don't drift. Seed with
    // one real id and one synthetic — only the real one should
    // survive into the grid.
    const seeded = createMemoryFavoritesStorage([
      'circle',
      'no_longer_a_real_shape' as ShapeId,
    ]);
    const tree = await mountPalette(seeded);
    await navigateToCategory(tree, 'favorites');
    expect(() => findByTestID(tree, TEST_IDS.cell('circle'))).not.toThrow();
    // Subsequent toggle persists the sanitised list — the synthetic
    // must not round-trip back to storage.
    await selectShape(tree, 'circle');
    await tapFavorite(tree); // remove circle
    await act(async () => {
      await flushPromises();
    });
    expect(await seeded.load()).toEqual([]);
  });

  it('disables the heart toggle until storage hydration completes', async () => {
    // Construct a storage whose load() never resolves so we can
    // observe the pre-hydration UI state. Without the hydration gate,
    // a fast user tap would mutate the empty placeholder array; the
    // delayed load() callback would then clobber it on resolution.
    const neverResolves: FavoritesStorage = {
      load: () => new Promise<readonly ShapeId[]>(() => {}),
      save: async () => {},
    };
    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette storage={neverResolves} />);
    });
    await act(async () => {
      await flushPromises();
    });
    const toggle = findByTestID(tree!, TEST_IDS.favoriteToggle);
    expect(toggle.props.disabled).toBe(true);
  });

  it('navigation auto-selects the first favorited shape when entering Favorites', async () => {
    // Seeded so the carousel has a non-empty favorites bucket to land on.
    const seeded = createMemoryFavoritesStorage(['octagon', 'circle']);
    const tree = await mountPalette(seeded);
    await navigateToCategory(tree, 'favorites');
    // Auto-select rule: the first shape in the new category becomes
    // the active selection so the preview shows something sensible.
    const previewIcon = tree.root.findByProps({
      testID: 'stroke-preview-icon',
    });
    expect(previewIcon.props.source).toBe(SHAPE_ICONS.octagon);
  });

  it('shows an error banner and does not add when favorites are at MAX_FAVORITES (capped)', async () => {
    // Seed storage with MAX_FAVORITES distinct real shape ids, excluding
    // the default selection ('rectangle') so there's a real un-favorited
    // shape left to tap-heart and trigger the cap.
    const seededIds = SHAPES.map(s => s.id)
      .filter(id => id !== 'rectangle')
      .slice(0, MAX_FAVORITES);
    expect(seededIds).toHaveLength(MAX_FAVORITES);
    const seeded = createMemoryFavoritesStorage(seededIds);
    const tree = await mountPalette(seeded);
    await tapFavorite(tree);
    const banner = findByTestID(tree, TEST_IDS.error);
    expect(banner).toBeTruthy();
    expect(banner.findByType(Text).props.children).toBe(
      `Max ${MAX_FAVORITES} favorites reached. Remove one first.`,
    );
    // Rectangle must NOT have been added — the toggle was rejected.
    expect(await seeded.load()).toEqual(seededIds);
  });

  it('does NOT insert when the heart toggle is tapped', async () => {
    // Heart toggle is a state mutation only — must not commit a shape.
    const tree = await mountPalette();
    await tapFavorite(tree);
    expect(PluginCommAPI.insertGeometry).not.toHaveBeenCalled();
    expect(PluginManager.closePluginView).not.toHaveBeenCalled();
  });

  it('ignores rapid double-tap of the overlay while a commit is in progress', async () => {
    let resolveInsert: () => void;
    (PluginCommAPI.insertGeometry as jest.Mock).mockImplementationOnce(
      () => new Promise<void>(r => { resolveInsert = r; }),
    );
    const tree = await mountPalette();

    // First overlay tap starts an in-flight insert.
    act(() => {
      tapOverlay(tree);
    });
    await act(async () => {
      await flushPromises();
    });
    // Second tap while pending — should be ignored.
    await act(async () => {
      tapOverlay(tree);
      await flushPromises();
    });
    expect(PluginCommAPI.insertGeometry).toHaveBeenCalledTimes(1);

    // Resolve the first one to clean up.
    await act(async () => {
      if (resolveInsert) {resolveInsert();}
      await flushPromises();
    });
  });

  // -------------------------------------------------------------------------
  // Defensive branches (cleanup, event isolation)
  // -------------------------------------------------------------------------

  it('tapping inside the panel does not propagate to the overlay (stopPropagation)', async () => {
    const tree = await mountPalette();
    // The overlay is a responder View (issue #15), so the panel is now
    // the first Pressable in the tree.
    const panelPressable = tree.root.findAllByType(Pressable)[0];
    const stopPropagation = jest.fn();
    act(() => {
      panelPressable.props.onPress({stopPropagation});
    });
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(PluginManager.closePluginView).not.toHaveBeenCalled();
    expect(PluginCommAPI.insertGeometry).not.toHaveBeenCalled();
  });

  it('unmounting without a pending error does not throw (cleanup no-op)', async () => {
    const tree = await mountPalette();
    expect(() => {
      act(() => { tree.unmount(); });
    }).not.toThrow();
  });

  it('clears the pending error-dismiss timer on unmount', async () => {
    (PluginCommAPI.insertGeometry as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const tree = await mountPalette();
    await pressInsert(tree);
    expect(() => findByTestID(tree, TEST_IDS.error)).not.toThrow();
    expect(() => {
      act(() => { tree.unmount(); });
    }).not.toThrow();
  });

  it('unmounting while favorites are still hydrating does not throw', async () => {
    const neverResolves: FavoritesStorage = {
      load: () => new Promise<readonly ShapeId[]>(() => {}),
      save: async () => {},
    };
    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette storage={neverResolves} />);
    });
    await act(async () => {
      await flushPromises();
    });
    expect(() => {
      act(() => { tree.unmount(); });
    }).not.toThrow();
  });

  it('ignores a favorites load that resolves after unmount (cancelled guard)', async () => {
    let resolveLoad: (v: readonly ShapeId[]) => void;
    const delayedStorage: FavoritesStorage = {
      load: () => new Promise(r => { resolveLoad = r; }),
      save: async () => {},
    };
    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette storage={delayedStorage} />);
    });
    await act(async () => { await flushPromises(); });
    act(() => { tree.unmount(); });
    // Resolve the load AFTER unmount — the `cancelled` guard must prevent
    // any post-unmount state update. act() would surface a React warning
    // as a failure if the guard were missing.
    await act(async () => {
      resolveLoad!(['circle']);
      await flushPromises();
    });
  });

  it('falls back to getDefaultFavoritesStorage() when no storage prop is provided', async () => {
    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette />);
    });
    await act(async () => {
      await flushPromises();
      await flushPromises();
    });
    expect(tree!.toJSON()).toBeTruthy();
  });

  it('replaces an in-flight error-dismiss timer when a second insert failure fires before the first clears', async () => {
    (PluginCommAPI.insertGeometry as jest.Mock)
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'));
    const tree = await mountPalette();
    await pressInsert(tree);
    expect(findByTestID(tree, TEST_IDS.error).findByType(Text).props.children).toBe('first');
    await pressInsert(tree);
    expect(findByTestID(tree, TEST_IDS.error).findByType(Text).props.children).toBe('second');
  });

  it('replaces an in-flight error-dismiss timer when a favorites-cap error follows an insert failure', async () => {
    // handleOverlayPress pre-clears errorTimerRef itself before each
    // attempt, so two insert failures in a row never exercise showError's
    // OWN stale-timer guard. handleToggleFavorite's "capped" path calls
    // showError without any such pre-clear, so chaining it after an
    // insert failure is what actually reaches that guard.
    (PluginCommAPI.insertGeometry as jest.Mock).mockRejectedValueOnce(new Error('insert boom'));
    const seededIds = SHAPES.map(s => s.id)
      .filter(id => id !== 'rectangle')
      .slice(0, MAX_FAVORITES);
    const seeded = createMemoryFavoritesStorage(seededIds);
    const tree = await mountPalette(seeded);
    await pressInsert(tree);
    expect(findByTestID(tree, TEST_IDS.error).findByType(Text).props.children).toBe(
      'insert boom',
    );
    await tapFavorite(tree); // 'rectangle' isn't in seededIds -> hits the cap
    expect(findByTestID(tree, TEST_IDS.error).findByType(Text).props.children).toBe(
      `Max ${MAX_FAVORITES} favorites reached. Remove one first.`,
    );
  });

  it('shows the default "Insert failed" message when insertGeometry rejects with a non-Error value', async () => {
    (PluginCommAPI.insertGeometry as jest.Mock).mockRejectedValueOnce('boom-string');
    const tree = await mountPalette();
    await pressInsert(tree);
    expect(findByTestID(tree, TEST_IDS.error).findByType(Text).props.children).toBe(
      'Insert failed',
    );
  });

  it('ignores a shape-cell tap while a commit is in flight (insertingRef guard)', async () => {
    let resolveInsert: () => void;
    (PluginCommAPI.insertGeometry as jest.Mock).mockImplementationOnce(
      () => new Promise<void>(r => { resolveInsert = r; }),
    );
    const tree = await mountPalette();
    act(() => { tapOverlay(tree); });
    await act(async () => { await flushPromises(); });
    await act(async () => {
      findByTestID(tree, TEST_IDS.cell('circle')).props.onPress();
      await flushPromises();
    });
    await act(async () => { resolveInsert(); await flushPromises(); });
    // Selection must still be the original default ('rectangle') — the
    // busy-window tap on 'circle' was dropped.
    await pressInsert(tree);
    const secondArg = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[1][0];
    expect(secondArg.type).toBe('GEO_polygon');
  });

  it('ignores width and color taps while a commit is in flight (insertingRef guard)', async () => {
    let resolveInsert: () => void;
    (PluginCommAPI.insertGeometry as jest.Mock).mockImplementationOnce(
      () => new Promise<void>(r => { resolveInsert = r; }),
    );
    const tree = await mountPalette();
    act(() => { tapOverlay(tree); });
    await act(async () => { await flushPromises(); });
    await act(async () => {
      findByTestID(tree, TEST_IDS.widthButton(900)).props.onPress();
      findByTestID(tree, TEST_IDS.colorButton(0xC9)).props.onPress();
      await flushPromises();
    });
    await act(async () => { resolveInsert(); await flushPromises(); });
    // Second commit reflects the UNCHANGED default style — the
    // busy-window picks were dropped.
    await pressInsert(tree);
    const secondArg = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[1][0];
    expect(secondArg.penWidth).toBe(PEN_DEFAULTS.penWidth);
    expect(secondArg.penColor).toBe(PEN_DEFAULTS.penColor);
  });

  it('ignores a favorite-toggle tap while a commit is in flight (insertingRef guard)', async () => {
    let resolveInsert: () => void;
    (PluginCommAPI.insertGeometry as jest.Mock).mockImplementationOnce(
      () => new Promise<void>(r => { resolveInsert = r; }),
    );
    const tree = await mountPalette();
    act(() => { tapOverlay(tree); });
    await act(async () => { await flushPromises(); });
    await act(async () => {
      findByTestID(tree, TEST_IDS.favoriteToggle).props.onPress();
      await flushPromises();
    });
    await act(async () => { resolveInsert(); await flushPromises(); });
    await navigateToCategory(tree, 'favorites');
    expect(() => findByTestID(tree, TEST_IDS.favoritesEmpty)).not.toThrow();
  });

  it('a favorite-toggle tap before hydration completes is dropped, not merged after hydration', async () => {
    let resolveLoad: (v: readonly ShapeId[]) => void;
    const delayedStorage: FavoritesStorage = {
      load: () => new Promise(r => { resolveLoad = r; }),
      save: async () => {},
    };
    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ShapePalette storage={delayedStorage} />);
    });
    await act(async () => { await flushPromises(); });
    // Tapping directly bypasses the `disabled` prop, which only the real
    // native renderer enforces — this exercises the internal
    // favoritesHydrated guard itself.
    await act(async () => {
      findByTestID(tree!, TEST_IDS.favoriteToggle).props.onPress();
      await flushPromises();
    });
    await act(async () => {
      resolveLoad!(['circle']);
      await flushPromises();
    });
    await navigateToCategory(tree!, 'favorites');
    expect(() => findByTestID(tree!, TEST_IDS.cell('circle'))).not.toThrow();
    expect(() => findByTestID(tree!, TEST_IDS.cell('rectangle'))).toThrow();
  });

  it('computes pressed styles for every interactive control without throwing', async () => {
    const tree = await mountPalette();
    const pressables = tree.root.findAllByType(Pressable);
    const withFunctionStyle = pressables.filter(p => typeof p.props.style === 'function');
    expect(withFunctionStyle.length).toBeGreaterThan(0);
    withFunctionStyle.forEach(p => {
      expect(() => p.props.style({pressed: true})).not.toThrow();
    });
  });
  // -------------------------------------------------------------------------
  // Pen placement — tap to place, drag to size (issue #15, F2)
  // -------------------------------------------------------------------------
  describe('pen placement', () => {
    function boundsOf(geo: {points: {x: number; y: number}[]}) {
      const xs = geo.points.map(p => p.x);
      const ys = geo.points.map(p => p.y);
      return {
        left: Math.min(...xs), right: Math.max(...xs),
        top: Math.min(...ys), bottom: Math.max(...ys),
      };
    }

    it('AC2.1: a tap inserts the default-size shape centred on the pen-down point', async () => {
      const tree = await mountPalette();
      expect(SCALE).toBeGreaterThan(0);
      await pressInsert(tree, {x: 400, y: 600});
      const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
      expect(geo.showLassoAfterInsert).toBe(true);
      expect(boundsOf(geo)).toEqual({
        left: px(400) - 100, right: px(400) + 100, top: px(600) - 100, bottom: px(600) + 100,
      });
    });

    it('AC2.2: a drag fits the rectangle into exactly the swept box', async () => {
      const tree = await mountPalette();
      await pressInsert(tree, {x: 100, y: 100}, {x: 300, y: 500});
      const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
      expect(boundsOf(geo)).toEqual({left: px(100), right: px(300), top: px(100), bottom: px(500)});
    });

    it('a drag entered bottom-right → top-left yields the same box', async () => {
      const tree = await mountPalette();
      await pressInsert(tree, {x: 300, y: 500}, {x: 100, y: 100});
      const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
      expect(boundsOf(geo)).toEqual({left: px(100), right: px(300), top: px(100), bottom: px(500)});
    });

    it('a release without a prior grant still commits at the release point', async () => {
      // Defensive: RN never fires release without grant, but the handler
      // must not throw or insert NaN geometry if it ever does.
      const tree = await mountPalette();
      await act(async () => {
        await overlayProps(tree).onResponderRelease(touchEvent({x: 400, y: 600}));
        await flushPromises();
      });
      const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
      expect(boundsOf(geo)).toEqual({
        left: px(400) - 100, right: px(400) + 100, top: px(600) - 100, bottom: px(600) + 100,
      });
    });

    it('AC2.4: rubber band appears only while dragging beyond the threshold', async () => {
      const tree = await mountPalette();
      const o = overlayProps(tree);
      expect(() => findByTestID(tree, TEST_IDS.rubberBand)).toThrow();
      act(() => { o.onResponderGrant(touchEvent({x: 100, y: 100})); });
      expect(() => findByTestID(tree, TEST_IDS.rubberBand)).toThrow();
      // Below threshold: still hidden.
      act(() => { o.onResponderMove(touchEvent({x: 105, y: 105})); });
      expect(() => findByTestID(tree, TEST_IDS.rubberBand)).toThrow();
      // Beyond threshold: visible, normalised to the swept box in dp.
      act(() => { o.onResponderMove(touchEvent({x: 50, y: 300})); });
      const band = findByTestID(tree, TEST_IDS.rubberBand);
      expect(band.props.pointerEvents).toBe('none');
      const flat = Object.assign({}, ...[band.props.style].flat());
      expect(flat).toMatchObject({left: 50, top: 100, width: 50, height: 200});
      // Wandering back inside the threshold hides it again.
      act(() => { o.onResponderMove(touchEvent({x: 102, y: 98})); });
      expect(() => findByTestID(tree, TEST_IDS.rubberBand)).toThrow();
      act(() => { o.onResponderMove(touchEvent({x: 300, y: 300})); });
      expect(findByTestID(tree, TEST_IDS.rubberBand)).toBeTruthy();
      await act(async () => {
        await o.onResponderRelease(touchEvent({x: 300, y: 300}));
        await flushPromises();
      });
      expect(() => findByTestID(tree, TEST_IDS.rubberBand)).toThrow();
      expect(PluginCommAPI.insertGeometry).toHaveBeenCalledTimes(1);
    });

    it('a move without a prior grant is ignored', async () => {
      const tree = await mountPalette();
      act(() => { overlayProps(tree).onResponderMove(touchEvent({x: 900, y: 900})); });
      expect(() => findByTestID(tree, TEST_IDS.rubberBand)).toThrow();
    });

    it('AC2.5: a terminated gesture clears the rubber band and never inserts', async () => {
      const tree = await mountPalette();
      const o = overlayProps(tree);
      act(() => {
        o.onResponderGrant(touchEvent({x: 100, y: 100}));
        o.onResponderMove(touchEvent({x: 400, y: 400}));
      });
      expect(findByTestID(tree, TEST_IDS.rubberBand)).toBeTruthy();
      act(() => { o.onResponderTerminate(); });
      expect(() => findByTestID(tree, TEST_IDS.rubberBand)).toThrow();
      await act(async () => { await flushPromises(); });
      expect(PluginCommAPI.insertGeometry).not.toHaveBeenCalled();
    });

    it('the overlay claims responder status for touches outside the panel', async () => {
      const tree = await mountPalette();
      expect(overlayProps(tree).onStartShouldSetResponder()).toBe(true);
    });

    it('logs the insertGeometry verdict for logcat diagnosis', async () => {
      const tree = await mountPalette();
      await pressInsert(tree, {x: 100, y: 100}, {x: 300, y: 500});
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[SHAPES] insertGeometry', 'drag', JSON.stringify({success: true}),
      );
    });

    it('shows the tap-or-drag hint in the footer', async () => {
      const tree = await mountPalette();
      expect(findByTestID(tree, TEST_IDS.footer).props.children).toBe(
        'Tap the page to place, or drag to draw a box.',
      );
    });

    it('AC2.3: touch dp are scaled by PixelRatio into page px', async () => {
      // TOUCH_SCALE is read once at module load, so the module must be
      // re-required with PixelRatio mocked. Everything React-related is
      // required inside the same isolated registry to avoid two Reacts.
      let insertMock: jest.Mock | undefined;
      let bounds: ReturnType<typeof boundsOf> | undefined;
      await jest.isolateModulesAsync(async () => {
        const RN = require('react-native');
        jest.spyOn(RN.PixelRatio, 'get').mockReturnValue(3);
        const IsoReact = require('react');
        const {create: isoCreate, act: isoAct} = require('react-test-renderer');
        const {PluginCommAPI: IsoComm} = require('sn-plugin-lib');
        const {default: IsoPalette, TEST_IDS: ISO_IDS} = require('../src/ShapePalette');
        insertMock = IsoComm.insertGeometry as jest.Mock;
        insertMock!.mockClear();
        let tree: ReactTestRenderer;
        isoAct(() => {
          tree = isoCreate(
            IsoReact.createElement(IsoPalette, {storage: createMemoryFavoritesStorage()}),
          );
        });
        await isoAct(async () => { await flushPromises(); await flushPromises(); });
        const o = tree!.root.findByProps({testID: ISO_IDS.overlay}).props;
        await isoAct(async () => {
          o.onResponderGrant(touchEvent({x: 100, y: 100}));
          await o.onResponderRelease(touchEvent({x: 300, y: 500}));
          await flushPromises();
        });
        bounds = boundsOf(insertMock!.mock.calls[0][0]);
      });
      expect(bounds).toEqual({left: 300, right: 900, top: 300, bottom: 1500});
    });
  });
});
