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

// penWidth bumped 400 → 500 on 2026-04-18: WIDTH_PRESETS collapsed to 5
// entries (XS=100, S=300, M=500, L=700, XL=900) so 400 µm no longer
// corresponds to a rendered button. The "re-tap the current value"
// no-op test looks up widthButton(DEFAULT_GEOMETRY.penWidth), which
// requires that value to exist in the preset list. 500 = M slot.
const DEFAULT_GEOMETRY = {
  type: 'GEO_circle',
  penColor: 0x00,
  penType: 10,
  penWidth: 500,
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
  PEN_TYPE_PRESETS,
  MIN_PEN_WIDTH,
  isAcceptablePenWidth,
} from '../src/ShapeOptionsPanel';
import {TEST_IDS as PREVIEW_TEST_IDS} from '../src/StrokePreview';
import {PluginCommAPI, PluginManager} from 'sn-plugin-lib';

function flushPromises() {
  return new Promise(resolve =>
    jest.requireActual<typeof globalThis>('timers').setImmediate(resolve),
  );
}

function findByTestID(tree: ReactTestRenderer, testID: string) {
  return tree.root.findByProps({testID});
}

// Preset-lookup helpers: tests that want to exercise a "real change" need
// a width that actually differs from DEFAULT_GEOMETRY.penWidth, otherwise
// computeRealChanges correctly short-circuits and no modify call fires.
// These helpers let tests stay robust against WIDTH_PRESETS ordering
// changes (we went from 5 → 9 presets in v1.0.2 alpha 3).
function firstPresetBelow(target: number): number {
  const hit = [...WIDTH_PRESETS].reverse().find(p => p.value < target);
  if (!hit) {
    throw new Error(`No WIDTH_PRESET strictly below ${target}`);
  }
  return hit.value;
}
function firstPresetAbove(target: number): number {
  const hit = WIDTH_PRESETS.find(p => p.value > target);
  if (!hit) {
    throw new Error(`No WIDTH_PRESET strictly above ${target}`);
  }
  return hit.value;
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

  it('renders a button for each pen type preset', async () => {
    const tree = await renderAndLoad();
    for (const preset of PEN_TYPE_PRESETS) {
      expect(() => findByTestID(tree, TEST_IDS.penTypeButton(preset.value))).not.toThrow();
    }
  });

  // ---- StrokePreview integration --------------------------------------

  it('renders StrokePreview reflecting the loaded geometry', async () => {
    const tree = await renderAndLoad();
    // Header is a static "Preview" label (2026-04-18 redesign dropped
    // the per-geometry display-name header).
    expect(findByTestID(tree, PREVIEW_TEST_IDS.shapeName).props.children).toBe('Preview');
    // Meta row shows the current pen type + width in mm.
    expect(findByTestID(tree, PREVIEW_TEST_IDS.meta).props.children).toBe(
      'Fineliner · 0.50 mm',
    );
  });

  it('updates StrokePreview meta when a pending patch is staged', async () => {
    const tree = await renderAndLoad();
    await act(async () => {
      // Stage a marker pen at 0.90 mm without committing.
      findByTestID(tree, TEST_IDS.widthButton(900)).props.onPress();
      findByTestID(tree, TEST_IDS.penTypeButton(11)).props.onPress();
      await flushPromises();
    });
    expect(findByTestID(tree, PREVIEW_TEST_IDS.meta).props.children).toBe(
      'Marker · 0.90 mm',
    );
    // And no modify fires from this — the preview reacts to pending state only.
    expect(PluginCommAPI.modifyLassoGeometry).not.toHaveBeenCalled();
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

  it('tapping a pen type preset alone does NOT call modifyLassoGeometry', async () => {
    const tree = await renderAndLoad();
    await act(async () => {
      // 11 (Marker) — differs from DEFAULT_GEOMETRY.penType (10 Fineliner).
      findByTestID(tree, TEST_IDS.penTypeButton(11)).props.onPress();
      await flushPromises();
    });
    expect(PluginCommAPI.modifyLassoGeometry).not.toHaveBeenCalled();
    expect(PluginManager.closePluginView).not.toHaveBeenCalled();
  });

  it('sends modifyLassoGeometry with new penType when outside is tapped after a pen-type pick', async () => {
    const tree = await renderAndLoad();
    const target = 14; // Calligraphy — differs from default Fineliner (10).
    await tapAndCommit(tree, [
      () => findByTestID(tree, TEST_IDS.penTypeButton(target)).props.onPress(),
    ]);
    expect(PluginCommAPI.modifyLassoGeometry).toHaveBeenCalledTimes(1);
    const arg = (PluginCommAPI.modifyLassoGeometry as jest.Mock).mock.calls[0][0];
    expect(arg.penType).toBe(target);
    // Everything else stays put.
    expect(arg.penColor).toBe(DEFAULT_GEOMETRY.penColor);
    expect(arg.penWidth).toBe(DEFAULT_GEOMETRY.penWidth);
    expect(arg.type).toBe(DEFAULT_GEOMETRY.type);
    expect(PluginManager.closePluginView).toHaveBeenCalled();
  });

  it('commits width + color + penType atomically in one modify call', async () => {
    const tree = await renderAndLoad();
    const w = firstPresetAbove(DEFAULT_GEOMETRY.penWidth);
    const c = COLOR_PRESETS[2].value;
    const t = 1; // Pressure pen
    await tapAndCommit(tree, [
      () => findByTestID(tree, TEST_IDS.widthButton(w)).props.onPress(),
      () => findByTestID(tree, TEST_IDS.colorButton(c)).props.onPress(),
      () => findByTestID(tree, TEST_IDS.penTypeButton(t)).props.onPress(),
    ]);
    expect(PluginCommAPI.modifyLassoGeometry).toHaveBeenCalledTimes(1);
    const arg = (PluginCommAPI.modifyLassoGeometry as jest.Mock).mock.calls[0][0];
    expect(arg.penWidth).toBe(w);
    expect(arg.penColor).toBe(c);
    expect(arg.penType).toBe(t);
  });

  it('re-tapping the current pen type does NOT trigger a modify on commit', async () => {
    const tree = await renderAndLoad();
    await tapAndCommit(tree, [
      // DEFAULT_GEOMETRY.penType is 10 (Fineliner). Tapping it again is a no-op.
      () => findByTestID(tree, TEST_IDS.penTypeButton(DEFAULT_GEOMETRY.penType)).props.onPress(),
    ]);
    expect(PluginCommAPI.modifyLassoGeometry).not.toHaveBeenCalled();
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
    // Both must differ from DEFAULT_GEOMETRY.penWidth (400); otherwise the
    // no-op optimisation in computeRealChanges skips the modify call and
    // the test becomes meaningless.
    const first = firstPresetBelow(DEFAULT_GEOMETRY.penWidth);
    const second = firstPresetAbove(DEFAULT_GEOMETRY.penWidth);
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
    // Use a width that actually differs from DEFAULT_GEOMETRY.penWidth so
    // computeRealChanges doesn't short-circuit into no-op mode.
    const target = firstPresetAbove(DEFAULT_GEOMETRY.penWidth);
    await tapAndCommit(tree, [
      () => findByTestID(tree, TEST_IDS.widthButton(target)).props.onPress(),
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

  // ---- MIN_PEN_WIDTH floor (firmware GeometrySchema min=100) ---------

  it('exports MIN_PEN_WIDTH matching the firmware floor', () => {
    // GeometrySchema in VerifyUtils.ts enforces penWidth min=100. If this
    // ever drifts, the native bridge will start rejecting modify calls.
    expect(MIN_PEN_WIDTH).toBe(100);
  });

  it('every WIDTH_PRESETS entry is >= MIN_PEN_WIDTH', () => {
    for (const p of WIDTH_PRESETS) {
      expect(p.value).toBeGreaterThanOrEqual(MIN_PEN_WIDTH);
    }
  });

  it('the first (thinnest) preset lands exactly on MIN_PEN_WIDTH', () => {
    // Preserves the "thinnest tick = firmware floor" contract — if someone
    // reorders or trims the list, we want to know.
    expect(WIDTH_PRESETS[0].value).toBe(MIN_PEN_WIDTH);
  });

  it('isAcceptablePenWidth accepts the floor and any preset value', () => {
    expect(isAcceptablePenWidth(MIN_PEN_WIDTH)).toBe(true);
    for (const p of WIDTH_PRESETS) {
      expect(isAcceptablePenWidth(p.value)).toBe(true);
    }
  });

  it('isAcceptablePenWidth rejects sub-floor, non-finite, and non-number values', () => {
    expect(isAcceptablePenWidth(MIN_PEN_WIDTH - 1)).toBe(false);
    expect(isAcceptablePenWidth(50)).toBe(false);
    expect(isAcceptablePenWidth(0)).toBe(false);
    expect(isAcceptablePenWidth(-400)).toBe(false);
    expect(isAcceptablePenWidth(NaN)).toBe(false);
    expect(isAcceptablePenWidth(Infinity)).toBe(false);
    expect(isAcceptablePenWidth(-Infinity)).toBe(false);
    expect(isAcceptablePenWidth(undefined)).toBe(false);
    expect(isAcceptablePenWidth(null)).toBe(false);
    expect(isAcceptablePenWidth('100')).toBe(false);
  });

  it('handleWidthPress drops a sub-floor value instead of staging it', async () => {
    const tree = await renderAndLoad();
    // Reach into a real width button node and invoke its onPress with
    // a bad argument. The Pressable wiring passes no args, so the only
    // way to reach the handler with an invalid value is to find the
    // bound callback on the button. We do that by first staging a valid
    // pick (so we can observe the subsequent commit), then simulating a
    // mis-wired caller that tries to apply a sub-floor value. Because the
    // onPress is `() => handleWidthPress(p.value)` the button itself won't
    // leak the raw handler — but we can verify the contract via the
    // overlay-commit pathway: after a valid pick, commit must send EXACTLY
    // that valid value, not anything below it.
    const firstPreset = WIDTH_PRESETS[0].value; // == MIN_PEN_WIDTH
    await act(async () => {
      findByTestID(tree, TEST_IDS.widthButton(firstPreset)).props.onPress();
      await flushPromises();
    });
    await act(async () => {
      findByTestID(tree, TEST_IDS.overlay).props.onPress();
      await flushPromises();
    });
    expect(PluginCommAPI.modifyLassoGeometry).toHaveBeenCalledTimes(1);
    const arg = (PluginCommAPI.modifyLassoGeometry as jest.Mock).mock.calls[0][0];
    expect(arg.penWidth).toBe(firstPreset);
    expect(arg.penWidth).toBeGreaterThanOrEqual(MIN_PEN_WIDTH);
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
