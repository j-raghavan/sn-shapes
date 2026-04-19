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
import {SHAPES, ShapeId} from '../src/shapes';
import {
  WIDTH_PRESETS,
  COLOR_PRESETS,
} from '../src/ShapeOptionsPanel';
import {PEN_DEFAULTS} from '../src/shapes';
import {TEST_IDS as PREVIEW_TEST_IDS} from '../src/StrokePreview';
import {PluginCommAPI, PluginFileAPI, PluginManager} from 'sn-plugin-lib';

function flushPromises() {
  return new Promise(resolve =>
    jest.requireActual<typeof globalThis>('timers').setImmediate(resolve)
  );
}

function findByTestID(tree: ReactTestRenderer, testID: string) {
  return tree.root.findByProps({testID});
}

function findAllCells(tree: ReactTestRenderer) {
  return SHAPES.map(s => findByTestID(tree, TEST_IDS.cell(s.id)));
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
async function mountPalette() {
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(<ShapePalette />);
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

  it('renders a cell for every shape', async () => {
    const tree = await mountPalette();
    expect(findAllCells(tree)).toHaveLength(SHAPES.length);
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
    // Every shape cell should be reachable from inside the shapes column.
    for (const s of SHAPES) {
      expect(
        shapesCol.findAllByProps({testID: TEST_IDS.cell(s.id)}).length,
      ).toBeGreaterThanOrEqual(1);
    }
    const previewCol = findByTestID(tree, TEST_IDS.previewColumn);
    // Preview column must not contain any shape cells.
    for (const s of SHAPES) {
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

  it('sets showLassoAfterInsert on the inserted geometry', async () => {
    const tree = await mountPalette();
    await selectShape(tree, 'rectangle');
    await pressInsert(tree);
    const geo = (PluginCommAPI.insertGeometry as jest.Mock).mock.calls[0][0];
    expect(geo.showLassoAfterInsert).toBe(true);
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
