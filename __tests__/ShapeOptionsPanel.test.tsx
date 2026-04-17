/**
 * Tests for src/ShapeOptionsPanel. Validates:
 *   - Loading state → empty state when no lasso selection
 *   - Populates current geometry via getLassoGeometries
 *   - Width picker sends merged geometry with new penWidth
 *   - Color picker sends merged geometry with new penColor
 *   - Delete calls deleteLassoElements and closes plugin view
 *   - Overlay tap closes without side-effects
 *   - API failures surface via error banner and do NOT close
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

jest.mock('sn-plugin-lib', () => ({
  PluginCommAPI: {
    getLassoGeometries: jest
      .fn()
      .mockResolvedValue({success: true, result: [DEFAULT_GEOMETRY]}),
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

  it('sends modifyLassoGeometry with merged penWidth when a width preset is tapped', async () => {
    const tree = await renderAndLoad();
    const target = WIDTH_PRESETS[0].value; // XS
    await act(async () => {
      findByTestID(tree, TEST_IDS.widthButton(target)).props.onPress();
      await flushPromises();
    });
    expect(PluginCommAPI.modifyLassoGeometry).toHaveBeenCalledTimes(1);
    const arg = (PluginCommAPI.modifyLassoGeometry as jest.Mock).mock.calls[0][0];
    // Merged result: retains original type/penColor/penType and swaps penWidth.
    expect(arg.type).toBe(DEFAULT_GEOMETRY.type);
    expect(arg.penColor).toBe(DEFAULT_GEOMETRY.penColor);
    expect(arg.penType).toBe(DEFAULT_GEOMETRY.penType);
    expect(arg.penWidth).toBe(target);
    expect(PluginManager.closePluginView).toHaveBeenCalled();
  });

  it('sends modifyLassoGeometry with merged penColor when a color preset is tapped', async () => {
    const tree = await renderAndLoad();
    const target = COLOR_PRESETS[1].value; // Gray
    await act(async () => {
      findByTestID(tree, TEST_IDS.colorButton(target)).props.onPress();
      await flushPromises();
    });
    expect(PluginCommAPI.modifyLassoGeometry).toHaveBeenCalledTimes(1);
    const arg = (PluginCommAPI.modifyLassoGeometry as jest.Mock).mock.calls[0][0];
    expect(arg.penColor).toBe(target);
    expect(arg.penWidth).toBe(DEFAULT_GEOMETRY.penWidth);
    expect(arg.type).toBe(DEFAULT_GEOMETRY.type);
    expect(PluginManager.closePluginView).toHaveBeenCalled();
  });

  it('preserves all non-pen geometry fields when patching', async () => {
    const tree = await renderAndLoad();
    await act(async () => {
      findByTestID(tree, TEST_IDS.widthButton(WIDTH_PRESETS[3].value)).props.onPress();
      await flushPromises();
    });
    const arg = (PluginCommAPI.modifyLassoGeometry as jest.Mock).mock.calls[0][0];
    expect(arg.ellipseCenterPoint).toEqual(DEFAULT_GEOMETRY.ellipseCenterPoint);
    expect(arg.ellipseMajorAxisRadius).toBe(DEFAULT_GEOMETRY.ellipseMajorAxisRadius);
    expect(arg.ellipseAngle).toBe(DEFAULT_GEOMETRY.ellipseAngle);
  });

  it('calls deleteLassoElements and closes when Delete is tapped', async () => {
    const tree = await renderAndLoad();
    await act(async () => {
      findByTestID(tree, TEST_IDS.delete).props.onPress();
      await flushPromises();
    });
    expect(PluginCommAPI.deleteLassoElements).toHaveBeenCalledTimes(1);
    expect(PluginManager.closePluginView).toHaveBeenCalled();
  });

  it('closes plugin view when the overlay is tapped', async () => {
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
    await act(async () => {
      findByTestID(tree, TEST_IDS.widthButton(WIDTH_PRESETS[0].value)).props.onPress();
      await flushPromises();
    });
    expect(() => findByTestID(tree, TEST_IDS.error)).not.toThrow();
    expect(PluginManager.closePluginView).not.toHaveBeenCalled();
  });

  it('shows error banner and does not close when modifyLassoGeometry throws', async () => {
    (PluginCommAPI.modifyLassoGeometry as jest.Mock).mockRejectedValueOnce(
      new Error('bridge blew up'),
    );
    const tree = await renderAndLoad();
    await act(async () => {
      findByTestID(tree, TEST_IDS.colorButton(COLOR_PRESETS[0].value)).props.onPress();
      await flushPromises();
    });
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
    await act(async () => {
      findByTestID(tree, TEST_IDS.widthButton(WIDTH_PRESETS[0].value)).props.onPress();
      await flushPromises();
    });
    expect(() => findByTestID(tree, TEST_IDS.error)).not.toThrow();
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(() => findByTestID(tree, TEST_IDS.error)).toThrow();
  });

  it('ignores rapid second tap while a modify is in flight', async () => {
    let resolveModify: ((value: unknown) => void) | null = null;
    (PluginCommAPI.modifyLassoGeometry as jest.Mock).mockImplementationOnce(
      () => new Promise(r => { resolveModify = r; }),
    );
    const tree = await renderAndLoad();
    act(() => {
      findByTestID(tree, TEST_IDS.widthButton(WIDTH_PRESETS[0].value)).props.onPress();
    });
    await act(async () => { await flushPromises(); });
    await act(async () => {
      findByTestID(tree, TEST_IDS.widthButton(WIDTH_PRESETS[1].value)).props.onPress();
      await flushPromises();
    });
    expect(PluginCommAPI.modifyLassoGeometry).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveModify?.({success: true});
      await flushPromises();
    });
  });
});
