import React from 'react';
import {create, act, ReactTestRenderer} from 'react-test-renderer';

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

beforeEach(() => {
  jest.useFakeTimers();
  (PluginCommAPI.insertGeometry as jest.Mock).mockClear();
  (PluginCommAPI.getCurrentFilePath as jest.Mock).mockClear();
  (PluginCommAPI.getCurrentPageNum as jest.Mock).mockClear();
  (PluginFileAPI.getPageSize as jest.Mock).mockClear();
  (PluginManager.closePluginView as jest.Mock).mockClear();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
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

// Helper: tap outside the panel — the overlay press is the new
// commit-and-close affordance (the explicit Insert button was dropped
// 2026-04-18). The overlay onPress is async (awaits insertShape) so we
// flush a few microtask ticks to let the promise chain settle.
async function pressInsert(tree: ReactTestRenderer) {
  await act(async () => {
    await findByTestID(tree, TEST_IDS.overlay).props.onPress();
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
    const staticCategories = CATEGORY_ORDER.filter(c => c !== 'favorites');
    const tree = await mountPalette();
    const representatives: ShapeId[] = staticCategories.map(c =>
      shapesInCategory(c)[0].id,
    );
    // Carousel landing is 'basic' (index 1 of CATEGORY_ORDER); the
    // representatives list is in CATEGORY_ORDER minus favorites, so
    // staticCategories[0] === 'basic' and we don't need to walk for it.
    for (let i = 0; i < representatives.length; i++) {
      const id = representatives[i];
      for (let j = 0; j < i; j++) {
        await act(async () => {
          findByTestID(tree, TEST_IDS.groupNext).props.onPress();
          await flushPromises();
        });
      }
      await selectShape(tree, id);
      await pressInsert(tree);
      for (let j = 0; j < i; j++) {
        await act(async () => {
          findByTestID(tree, TEST_IDS.groupPrev).props.onPress();
          await flushPromises();
        });
      }
    }
    expect(PluginCommAPI.insertGeometry).toHaveBeenCalledTimes(
      representatives.length,
    );
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
  it('centers the inserted shape on the resolved page size', async () => {
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
    await pressInsert(tree);
    expect(PluginFileAPI.getPageSize).toHaveBeenCalledWith('/note/my.note', 3);
    const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
    const xs = geo.points.map((p: {x: number}) => p.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    expect((minX + maxX) / 2).toBeCloseTo(1920 / 2, -1);
  });

  it('falls back to default page width when getCurrentFilePath fails', async () => {
    (PluginCommAPI.getCurrentFilePath as jest.Mock).mockRejectedValueOnce(
      new Error('unavailable'),
    );
    const tree = await mountPalette();
    await pressInsert(tree);
    expect(PluginFileAPI.getPageSize).not.toHaveBeenCalled();
    const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
    const xs = geo.points.map((p: {x: number}) => p.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(
      DEFAULT_PAGE_WIDTH / 2,
      -1,
    );
  });

  it('falls back to default page width when getPageSize fails', async () => {
    (PluginFileAPI.getPageSize as jest.Mock).mockRejectedValueOnce(
      new Error('unavailable'),
    );
    const tree = await mountPalette();
    await pressInsert(tree);
    const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
    const xs = geo.points.map((p: {x: number}) => p.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(
      DEFAULT_PAGE_WIDTH / 2,
      -1,
    );
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
      findByTestID(tree, TEST_IDS.overlay).props.onPress();
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

  // The MAX_FAVORITES cap behavior is covered exhaustively at the pure
  // reducer level in shapes.test.ts (`toggleFavorite returns "capped"
  // with the input unchanged at the limit`). Exercising it through
  // the UI here would require seeding storage with MAX_FAVORITES
  // distinct *valid* shape ids — but with MAX_FAVORITES === SHAPES.length
  // in the current catalogue, every real shape would already be
  // favorited and there would be no unfavorited shape to tap. The
  // post-hydration sanitisation step (which correctly drops synthetic
  // placeholder ids) closes the synthetic-seed loophole. Once the
  // catalogue grows past MAX_FAVORITES, add a UI-level cap test here.

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
      findByTestID(tree, TEST_IDS.overlay).props.onPress();
    });
    await act(async () => {
      await flushPromises();
    });
    // Second tap while pending — should be ignored.
    await act(async () => {
      findByTestID(tree, TEST_IDS.overlay).props.onPress();
      await flushPromises();
    });
    expect(PluginCommAPI.insertGeometry).toHaveBeenCalledTimes(1);

    // Resolve the first one to clean up.
    await act(async () => {
      if (resolveInsert) {resolveInsert();}
      await flushPromises();
    });
  });
});
