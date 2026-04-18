/**
 * Tests for src/ShapeOptionsPanel. Validates:
 *   - Loading state → empty state when no lasso selection
 *   - Populates current geometry via getLassoGeometries
 *   - Width/color taps update pending patch state only (no immediate modify)
 *   - Overlay tap commits pending patch via modifyLassoGeometry and closes
 *   - Pending patch survives across multiple taps in one session
 *   - Re-tapping an already-applied value does NOT produce a no-op modify
 *   - Delete calls deleteLassoElements immediately and closes plugin view
 *   - API failures surface via error banner and do NOT close
 *   - Lasso-resize delta is baked at commit time
 */
import React from 'react';
import {create, act, ReactTestRenderer} from 'react-test-renderer';

const DEFAULT_GEOMETRY = {
  type: 'GEO_circle',
  penColor: 0x00,
  penType: 10,
  penWidth: 400,
  ellipseCenterPoint: {x: 500, y: 500},
  ellipseMajorAxisRadius: 100,
  ellipseMinorAxisRadius: 100,
  ellipseAngle: 0,
};

// Natural bounds for DEFAULT_GEOMETRY (circle at 500,500 r=100, θ=0):
// left/right/top/bottom = 400/600/400/600.
const DEFAULT_LASSO_RECT = {left: 400, top: 400, right: 600, bottom: 600};

jest.mock('sn-plugin-lib', () => ({
  PluginCommAPI: {
    getLassoGeometries: jest
      .fn()
      .mockResolvedValue({success: true, result: [DEFAULT_GEOMETRY]}),
    getLassoRect: jest
      .fn()
      .mockResolvedValue({success: true, result: DEFAULT_LASSO_RECT}),
    modifyLassoGeometry: jest.fn().mockResolvedValue({success: true}),
    deleteLassoElements: jest.fn().mockResolvedValue({success: true}),
  },
  PluginManager: {
    closePluginView: jest.fn().mockResolvedValue(true),
  },
}));

import ShapeOptionsPanel, {
  TEST_IDS,
  WIDTH_PRESETS,
  COLOR_PRESETS,
} from '../src/ShapeOptionsPanel';
import {PluginCommAPI, PluginManager} from 'sn-plugin-lib';

function flushPromises() {
  return new Promise(resolve =>
    jest.requireActual<typeof globalThis>('timers').setImmediate(resolve),
  );
}

function findByTestID(tree: ReactTestRenderer, testID: string) {
  return tree.root.findByProps({testID});
}

let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  (PluginCommAPI.getLassoGeometries as jest.Mock)
    .mockClear()
    .mockResolvedValue({success: true, result: [DEFAULT_GEOMETRY]});
  (PluginCommAPI.getLassoRect as jest.Mock)
    .mockClear()
    .mockResolvedValue({success: true, result: DEFAULT_LASSO_RECT});
  (PluginCommAPI.modifyLassoGeometry as jest.Mock)
    .mockClear()
    .mockResolvedValue({success: true});
  (PluginCommAPI.deleteLassoElements as jest.Mock)
    .mockClear()
    .mockResolvedValue({success: true});
  (PluginManager.closePluginView as jest.Mock).mockClear();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  consoleErrorSpy.mockRestore();
});

async function renderAndLoad(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<ShapeOptionsPanel />);
  });
  // Let the getLassoGeometries promise settle so loading → body transitions.
  await act(async () => {
    await flushPromises();
  });
  return tree;
}

describe('ShapeOptionsPanel', () => {
  it('renders without crashing', async () => {
    const tree = await renderAndLoad();
    expect(tree.toJSON()).toBeTruthy();
  });

  it('reads the lassoed geometry on mount', async () => {
    await renderAndLoad();
    expect(PluginCommAPI.getLassoGeometries).toHaveBeenCalledTimes(1);
  });

  it('shows an empty-state message when getLassoGeometries returns nothing', async () => {
    (PluginCommAPI.getLassoGeometries as jest.Mock).mockResolvedValueOnce({
      success: true,
      result: [],
    });
    const tree = await renderAndLoad();
    expect(() => findByTestID(tree, TEST_IDS.empty)).not.toThrow();
    expect(() => findByTestID(tree, TEST_IDS.delete)).toThrow();
  });

  it('shows empty-state when getLassoGeometries fails outright', async () => {
    (PluginCommAPI.getLassoGeometries as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: {code: 1, message: 'nope'},
    });
    const tree = await renderAndLoad();
    expect(() => findByTestID(tree, TEST_IDS.empty)).not.toThrow();
  });

  it('shows empty-state if geometry is missing required pen fields', async () => {
    (PluginCommAPI.getLassoGeometries as jest.Mock).mockResolvedValueOnce({
      success: true,
      result: [{type: 'GEO_circle'}],
    });
    const tree = await renderAndLoad();
    expect(() => findByTestID(tree, TEST_IDS.empty)).not.toThrow();
  });

  it('renders a button for each width preset', async () => {
    const tree = await renderAndLoad();
    for (const preset of WIDTH_PRESETS) {
      expect(() => findByTestID(tree, TEST_IDS.widthButton(preset.value))).not.toThrow();
    }
  });

  it('renders a button for each color preset', async () => {
    const tree = await renderAndLoad();
    for (const preset of COLOR_PRESETS) {
      expect(() => findByTestID(tree, TEST_IDS.colorButton(preset.value))).not.toThrow();
    }
  });

  // ---- Deferred-apply: taps update pending state, overlay commits ---

  async function tapAndCommit(
    tree: ReactTestRenderer,
    taps: Array<() => void>,
  ) {
    await act(async () => {
      for (const t of taps) {t();}
      await flushPromises();
    });
    await act(async () => {
      findByTestID(tree, TEST_IDS.overlay).props.onPress();
      await flushPromises();
    });
  }

  it('tapping a width preset alone does NOT call modifyLassoGeometry', async () => {
    const tree = await renderAndLoad();
    await act(async () => {
      findByTestID(tree, TEST_IDS.widthButton(WIDTH_PRESETS[0].value)).props.onPress();
      await flushPromises();
    });
    expect(PluginCommAPI.modifyLassoGeometry).not.toHaveBeenCalled();
    expect(PluginManager.closePluginView).not.toHaveBeenCalled();
  });

  it('tapping a color preset alone does NOT call modifyLassoGeometry', async () => {
    const tree = await renderAndLoad();
    await act(async () => {
      findByTestID(tree, TEST_IDS.colorButton(COLOR_PRESETS[1].value)).props.onPress();
      await flushPromises();
    });
    expect(PluginCommAPI.modifyLassoGeometry).not.toHaveBeenCalled();
    expect(PluginManager.closePluginView).not.toHaveBeenCalled();
  });

  it('sends modifyLassoGeometry with new penWidth when outside is tapped after a width pick', async () => {
    const tree = await renderAndLoad();
    const target = WIDTH_PRESETS[0].value;
    await tapAndCommit(tree, [
      () => findByTestID(tree, TEST_IDS.widthButton(target)).props.onPress(),
    ]);
    expect(PluginCommAPI.modifyLassoGeometry).toHaveBeenCalledTimes(1);
    const arg = (PluginCommAPI.modifyLassoGeometry as jest.Mock).mock.calls[0][0];
    expect(arg.type).toBe(DEFAULT_GEOMETRY.type);
    expect(arg.penColor).toBe(DEFAULT_GEOMETRY.penColor);
    expect(arg.penType).toBe(DEFAULT_GEOMETRY.penType);
    expect(arg.penWidth).toBe(target);
    expect(PluginManager.closePluginView).toHaveBeenCalled();
  });

  it('sends modifyLassoGeometry with new penColor when outside is tapped after a color pick', async () => {
    const tree = await renderAndLoad();
    const target = COLOR_PRESETS[1].value;
    await tapAndCommit(tree, [
      () => findByTestID(tree, TEST_IDS.colorButton(target)).props.onPress(),
    ]);
    expect(PluginCommAPI.modifyLassoGeometry).toHaveBeenCalledTimes(1);
    const arg = (PluginCommAPI.modifyLassoGeometry as jest.Mock).mock.calls[0][0];
    expect(arg.penColor).toBe(target);
    expect(arg.penWidth).toBe(DEFAULT_GEOMETRY.penWidth);
    expect(arg.type).toBe(DEFAULT_GEOMETRY.type);
    expect(PluginManager.closePluginView).toHaveBeenCalled();
  });

  it('commits BOTH width and color in a single modify when picked together', async () => {
    const tree = await renderAndLoad();
    const w = WIDTH_PRESETS[4].value; // XL
    const c = COLOR_PRESETS[2].value; // Light
    await tapAndCommit(tree, [
      () => findByTestID(tree, TEST_IDS.widthButton(w)).props.onPress(),
      () => findByTestID(tree, TEST_IDS.colorButton(c)).props.onPress(),
    ]);
    expect(PluginCommAPI.modifyLassoGeometry).toHaveBeenCalledTimes(1);
    const arg = (PluginCommAPI.modifyLassoGeometry as jest.Mock).mock.calls[0][0];
    expect(arg.penWidth).toBe(w);
    expect(arg.penColor).toBe(c);
    expect(PluginManager.closePluginView).toHaveBeenCalled();
  });

  it('last width pick wins when the user changes their mind before committing', async () => {
    const tree = await renderAndLoad();
    const first = WIDTH_PRESETS[0].value;
    const second = WIDTH_PRESETS[3].value;
    await tapAndCommit(tree, [
      () => findByTestID(tree, TEST_IDS.widthButton(first)).props.onPress(),
      () => findByTestID(tree, TEST_IDS.widthButton(second)).props.onPress(),
    ]);
    expect(PluginCommAPI.modifyLassoGeometry).toHaveBeenCalledTimes(1);
    const arg = (PluginCommAPI.modifyLassoGeometry as jest.Mock).mock.calls[0][0];
    expect(arg.penWidth).toBe(second);
  });

  it('preserves all non-pen geometry fields when committing', async () => {
    const tree = await renderAndLoad();
    await tapAndCommit(tree, [
      () => findByTestID(tree, TEST_IDS.widthButton(WIDTH_PRESETS[3].value)).props.onPress(),
    ]);
    const arg = (PluginCommAPI.modifyLassoGeometry as jest.Mock).mock.calls[0][0];
    expect(arg.ellipseCenterPoint).toEqual(DEFAULT_GEOMETRY.ellipseCenterPoint);
    expect(arg.ellipseMajorAxisRadius).toBe(DEFAULT_GEOMETRY.ellipseMajorAxisRadius);
    expect(arg.ellipseAngle).toBe(DEFAULT_GEOMETRY.ellipseAngle);
  });

  it('re-tapping the value the shape already has does NOT trigger a modify on commit', async () => {
    const tree = await renderAndLoad();
    await tapAndCommit(tree, [
      // DEFAULT_GEOMETRY already has penWidth=400 and penColor=0x00 —
      // tapping them again is a no-op.
      () => findByTestID(tree, TEST_IDS.widthButton(DEFAULT_GEOMETRY.penWidth)).props.onPress(),
      () => findByTestID(tree, TEST_IDS.colorButton(DEFAULT_GEOMETRY.penColor)).props.onPress(),
    ]);
    expect(PluginCommAPI.modifyLassoGeometry).not.toHaveBeenCalled();
    // But the panel still closes.
    expect(PluginManager.closePluginView).toHaveBeenCalled();
  });

  it('calls deleteLassoElements and closes when Delete is tapped (pending patch is discarded)', async () => {
    const tree = await renderAndLoad();
    await act(async () => {
      // Build up a pending patch that should NOT be applied once we delete.
      findByTestID(tree, TEST_IDS.widthButton(WIDTH_PRESETS[0].value)).props.onPress();
      findByTestID(tree, TEST_IDS.delete).props.onPress();
      await flushPromises();
    });
    expect(PluginCommAPI.deleteLassoElements).toHaveBeenCalledTimes(1);
    expect(PluginCommAPI.modifyLassoGeometry).not.toHaveBeenCalled();
    expect(PluginManager.closePluginView).toHaveBeenCalled();
  });

  it('closes plugin view when the overlay is tapped with no changes (no modify call)', async () => {
    const tree = await renderAndLoad();
    await act(async () => {
      findByTestID(tree, TEST_IDS.overlay).props.onPress();
      await flushPromises();
    });
    expect(PluginManager.closePluginView).toHaveBeenCalled();
    expect(PluginCommAPI.modifyLassoGeometry).not.toHaveBeenCalled();
    expect(PluginCommAPI.deleteLassoElements).not.toHaveBeenCalled();
  });

  it('shows error banner and does not close when modifyLassoGeometry returns success:false', async () => {
    (PluginCommAPI.modifyLassoGeometry as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: {code: 4, message: 'host rejected'},
    });
    const tree = await renderAndLoad();
    await tapAndCommit(tree, [
      () => findByTestID(tree, TEST_IDS.widthButton(WIDTH_PRESETS[0].value)).props.onPress(),
    ]);
    expect(() => findByTestID(tree, TEST_IDS.error)).not.toThrow();
    expect(PluginManager.closePluginView).not.toHaveBeenCalled();
  });

  it('shows error banner and does not close when modifyLassoGeometry throws', async () => {
    (PluginCommAPI.modifyLassoGeometry as jest.Mock).mockRejectedValueOnce(
      new Error('bridge blew up'),
    );
    const tree = await renderAndLoad();
    await tapAndCommit(tree, [
      () => findByTestID(tree, TEST_IDS.colorButton(COLOR_PRESETS[1].value)).props.onPress(),
    ]);
    expect(() => findByTestID(tree, TEST_IDS.error)).not.toThrow();
    expect(PluginManager.closePluginView).not.toHaveBeenCalled();
  });

  it('shows error banner and does not close when deleteLassoElements returns success:false', async () => {
    (PluginCommAPI.deleteLassoElements as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: {code: 5, message: 'cannot delete'},
    });
    const tree = await renderAndLoad();
    await act(async () => {
      findByTestID(tree, TEST_IDS.delete).props.onPress();
      await flushPromises();
    });
    expect(() => findByTestID(tree, TEST_IDS.error)).not.toThrow();
    expect(PluginManager.closePluginView).not.toHaveBeenCalled();
  });

  it('auto-dismisses the error banner after the timeout', async () => {
    (PluginCommAPI.modifyLassoGeometry as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: {code: 4, message: 'host rejected'},
    });
    const tree = await renderAndLoad();
    await tapAndCommit(tree, [
      () => findByTestID(tree, TEST_IDS.widthButton(WIDTH_PRESETS[0].value)).props.onPress(),
    ]);
    expect(() => findByTestID(tree, TEST_IDS.error)).not.toThrow();
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(() => findByTestID(tree, TEST_IDS.error)).toThrow();
  });

  // ---- v1.0.2: preserve lasso resize when modifying ------------------

  it('reads the lasso rect on mount', async () => {
    await renderAndLoad();
    expect(PluginCommAPI.getLassoRect).toHaveBeenCalledTimes(1);
  });

  it('bakes the lasso-resize delta into the geometry before modify', async () => {
    // Simulate the user having dragged the lasso to 2x size: natural bounds
    // for DEFAULT_GEOMETRY are 400..600, but lasso is now 300..700.
    (PluginCommAPI.getLassoRect as jest.Mock).mockResolvedValueOnce({
      success: true,
      result: {left: 300, top: 300, right: 700, bottom: 700},
    });
    const tree = await renderAndLoad();
    await tapAndCommit(tree, [
      () => findByTestID(tree, TEST_IDS.colorButton(COLOR_PRESETS[1].value)).props.onPress(),
    ]);
    const arg = (PluginCommAPI.modifyLassoGeometry as jest.Mock).mock.calls[0][0];
    // Radii should have been scaled 2x (100 → 200), center unchanged at 500,500.
    expect(arg.ellipseMajorAxisRadius).toBe(200);
    expect(arg.ellipseMinorAxisRadius).toBe(200);
    expect(arg.ellipseCenterPoint).toEqual({x: 500, y: 500});
    // Pen patch still applied on top of the baked geometry.
    expect(arg.penColor).toBe(COLOR_PRESETS[1].value);
  });

  it('does not bake when lasso rect matches natural bounds (no user resize)', async () => {
    // Default mock already returns matching rect; confirm no-op.
    const tree = await renderAndLoad();
    await tapAndCommit(tree, [
      () => findByTestID(tree, TEST_IDS.widthButton(WIDTH_PRESETS[0].value)).props.onPress(),
    ]);
    const arg = (PluginCommAPI.modifyLassoGeometry as jest.Mock).mock.calls[0][0];
    expect(arg.ellipseMajorAxisRadius).toBe(DEFAULT_GEOMETRY.ellipseMajorAxisRadius);
    expect(arg.ellipseMinorAxisRadius).toBe(DEFAULT_GEOMETRY.ellipseMinorAxisRadius);
    expect(arg.ellipseCenterPoint).toEqual(DEFAULT_GEOMETRY.ellipseCenterPoint);
  });

  it('falls back to un-baked modify when getLassoRect fails', async () => {
    (PluginCommAPI.getLassoRect as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: {code: 1, message: 'unavailable'},
    });
    const tree = await renderAndLoad();
    // Pick a width that actually differs from the default so commit fires.
    const target = WIDTH_PRESETS[0].value; // XS, != default M
    await tapAndCommit(tree, [
      () => findByTestID(tree, TEST_IDS.widthButton(target)).props.onPress(),
    ]);
    // Without a valid rect we send the original geometry with just the
    // pen patch — v1.0.1 behavior, no crash.
    expect(PluginCommAPI.modifyLassoGeometry).toHaveBeenCalledTimes(1);
    const arg = (PluginCommAPI.modifyLassoGeometry as jest.Mock).mock.calls[0][0];
    expect(arg.ellipseMajorAxisRadius).toBe(DEFAULT_GEOMETRY.ellipseMajorAxisRadius);
    expect(arg.penWidth).toBe(target);
  });

  // --------------------------------------------------------------------

  it('ignores a second commit attempt while a modify is in flight', async () => {
    let resolveModify: ((value: unknown) => void) | null = null;
    (PluginCommAPI.modifyLassoGeometry as jest.Mock).mockImplementationOnce(
      () => new Promise(r => { resolveModify = r; }),
    );
    const tree = await renderAndLoad();
    // Stage a pending change first so that commit triggers a modify.
    await act(async () => {
      findByTestID(tree, TEST_IDS.widthButton(WIDTH_PRESETS[0].value)).props.onPress();
      await flushPromises();
    });
    // First overlay tap kicks off modify and blocks on it.
    act(() => {
      findByTestID(tree, TEST_IDS.overlay).props.onPress();
    });
    await act(async () => { await flushPromises(); });
    // Second overlay tap must be ignored while modify is still in flight.
    await act(async () => {
      findByTestID(tree, TEST_IDS.overlay).props.onPress();
      await flushPromises();
    });
    expect(PluginCommAPI.modifyLassoGeometry).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveModify?.({success: true});
      await flushPromises();
    });
  });
});
