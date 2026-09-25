/**
 * Tests for src/ShapeOptionsPanel — the Edit Shape panel behind the
 * lasso-toolbar Shapes button (#17, SPEC-FREE-RESIZE FR7). Covers the
 * loading → unsupported | ready → resizing state machine, degradation when
 * lasso reads fail, the resize gesture → modifyLassoGeometry path, and the
 * failure / double-release / unmount windows.
 */
import React from 'react';
import {create, act, ReactTestRenderer} from 'react-test-renderer';
import {Text} from 'react-native';

const SQUARE = {
  type: 'GEO_polygon',
  penColor: 0x9d,
  penType: 10,
  penWidth: 500,
  points: [
    {x: 100, y: 100}, {x: 300, y: 100}, {x: 300, y: 300}, {x: 100, y: 300}, {x: 100, y: 100},
  ],
};

const CIRCLE = {
  type: 'GEO_circle',
  penColor: 0x00,
  penType: 10,
  penWidth: 300,
  ellipseCenterPoint: {x: 500, y: 500},
  ellipseMajorAxisRadius: 100,
  ellipseMinorAxisRadius: 100,
  ellipseAngle: 0,
};

// Firmware reports the visual bounds, a little larger than the vertices.
const LASSO_RECT = {left: 90, top: 90, right: 310, bottom: 310};

jest.mock('sn-plugin-lib', () => ({
  PluginCommAPI: {
    getLassoGeometries: jest.fn(),
    getLassoRect: jest.fn(),
    getLassoElementTypeCounts: jest.fn(),
    modifyLassoGeometry: jest.fn(),
    getCurrentFilePath: jest.fn(),
    getCurrentPageNum: jest.fn(),
  },
  PluginFileAPI: {
    getPageSize: jest.fn(),
  },
  PluginManager: {
    closePluginView: jest.fn(),
  },
}));

import ShapeOptionsPanel, {
  RESIZE_HINT,
  TAP_HINT,
  TEST_IDS,
  UNSUPPORTED_MESSAGE,
} from '../src/ShapeOptionsPanel';
import {OVERLAY_TEST_IDS} from '../src/PlacementOverlay';
import {geometryNaturalBounds, Geometry} from '../src/lassoTransform';
import {PluginCommAPI, PluginFileAPI, PluginManager} from 'sn-plugin-lib';

const SCALE = 2;
const api = PluginCommAPI as unknown as Record<string, jest.Mock>;
const closeView = PluginManager.closePluginView as jest.Mock;

function flushPromises() {
  return new Promise(resolve =>
    jest.requireActual<typeof globalThis>('timers').setImmediate(resolve),
  );
}

function has(tree: ReactTestRenderer, testID: string): boolean {
  return tree.root.findAllByProps({testID}).length > 0;
}

function byId(tree: ReactTestRenderer, testID: string) {
  return tree.root.findByProps({testID});
}

async function mount(): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(<ShapeOptionsPanel scale={SCALE} />);
  });
  await act(async () => {
    await flushPromises();
    await flushPromises();
  });
  return tree!;
}

async function press(tree: ReactTestRenderer, testID: string) {
  await act(async () => {
    byId(tree, testID).props.onPress({stopPropagation() {}});
    await flushPromises();
  });
}

function touch(x: number, y: number) {
  return {nativeEvent: {pageX: x, pageY: y}};
}

/** Pen-down / pen-up on the resize overlay, in dp. */
async function gesture(tree: ReactTestRenderer, down: [number, number], up: [number, number]) {
  const o = byId(tree, OVERLAY_TEST_IDS.overlay).props;
  await act(async () => {
    o.onResponderGrant(touch(...down));
    await o.onResponderRelease(touch(...up));
    await flushPromises();
    await flushPromises();
  });
}

function lastModified(): Geometry {
  const calls = api.modifyLassoGeometry.mock.calls;
  return calls[calls.length - 1][0];
}

let consoleErrorSpy: jest.SpyInstance;
let consoleLogSpy: jest.SpyInstance;
let consoleWarnSpy: jest.SpyInstance;

const hintText = (tree: ReactTestRenderer) =>
  byId(tree, TEST_IDS.resizeHint).findAllByType(Text)[0].props.children;

beforeEach(() => {
  jest.useFakeTimers();
  Object.values(api).forEach(m => m.mockReset());
  (PluginFileAPI.getPageSize as jest.Mock).mockReset();
  closeView.mockReset().mockResolvedValue(true);
  api.getLassoGeometries.mockResolvedValue({success: true, result: [SQUARE]});
  api.getLassoRect.mockResolvedValue({success: true, result: LASSO_RECT});
  api.getLassoElementTypeCounts.mockResolvedValue({success: true, result: {geometryNum: 1, trailNum: 0}});
  api.modifyLassoGeometry.mockResolvedValue({success: true, result: true});
  api.getCurrentFilePath.mockResolvedValue({success: true, result: '/note/a.note'});
  api.getCurrentPageNum.mockResolvedValue({success: true, result: 0});
  (PluginFileAPI.getPageSize as jest.Mock).mockResolvedValue({success: true, result: {width: 1404, height: 1872}});
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  consoleErrorSpy.mockRestore();
  consoleLogSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

describe('ShapeOptionsPanel (Edit Shape)', () => {
  describe('loading and eligibility', () => {
    it('AC7.1 mid-operation: shows Loading… and no Resize action until reads resolve', async () => {
      let resolveGeometries: (v: unknown) => void = () => {};
      api.getLassoGeometries.mockReturnValue(new Promise(r => { resolveGeometries = r; }));
      let tree: ReactTestRenderer;
      act(() => {
        tree = create(<ShapeOptionsPanel scale={SCALE} />);
      });
      await act(async () => { await flushPromises(); });
      expect(has(tree!, TEST_IDS.loading)).toBe(true);
      expect(has(tree!, TEST_IDS.resize)).toBe(false);
      await act(async () => {
        resolveGeometries({success: true, result: [SQUARE]});
        await flushPromises();
      });
      expect(has(tree!, TEST_IDS.loading)).toBe(false);
      expect(has(tree!, TEST_IDS.resize)).toBe(true);
    });

    it('AC7.2: one lone geometry offers Resize freely', async () => {
      const tree = await mount();
      expect(has(tree, TEST_IDS.resize)).toBe(true);
      expect(has(tree, TEST_IDS.unsupported)).toBe(false);
    });

    it('logs the lasso counts for device diagnosis', async () => {
      await mount();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[EDIT_SHAPE] counts', JSON.stringify({success: true, result: {geometryNum: 1, trailNum: 0}}),
      );
    });

    it.each([
      ['two geometries', () => api.getLassoGeometries.mockResolvedValue({success: true, result: [SQUARE, CIRCLE]})],
      ['a stroke in the selection', () =>
        api.getLassoElementTypeCounts.mockResolvedValue({success: true, result: {geometryNum: 1, trailNum: 2}})],
      ['no geometry', () => api.getLassoGeometries.mockResolvedValue({success: true, result: []})],
      ['a failed geometry read', () => api.getLassoGeometries.mockResolvedValue({success: false})],
      ['a throwing geometry read', () => api.getLassoGeometries.mockRejectedValue(new Error('bridge'))],
      ['a non-array result', () => api.getLassoGeometries.mockResolvedValue({success: true, result: {}})],
      ['a malformed geometry', () =>
        api.getLassoGeometries.mockResolvedValue({success: true, result: [{type: 'GEO_polygon'}]})],
      ['a null geometry entry', () => api.getLassoGeometries.mockResolvedValue({success: true, result: [null]})],
    ])('AC7.2: %s → "Select a single shape to resize."', async (_label, arrange) => {
      arrange();
      const tree = await mount();
      expect(has(tree, TEST_IDS.resize)).toBe(false);
      const text = byId(tree, TEST_IDS.unsupported).findByType(Text);
      expect(text.props.children).toBe(UNSUPPORTED_MESSAGE);
    });

    it('B: unusable counts fall back to the geometry list and warn', async () => {
      api.getLassoElementTypeCounts.mockResolvedValue({success: true, result: {trailNum: 4}});
      const tree = await mount();
      expect(has(tree, TEST_IDS.resize)).toBe(true);
      expect(consoleWarnSpy).toHaveBeenCalledWith('[EDIT_SHAPE] counts unavailable, falling back to geometry list');
    });

    it('B: usable counts do not warn', async () => {
      await mount();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('C: a lasso rect with a NaN side falls back to the natural bounds', async () => {
      api.getLassoRect.mockResolvedValue({success: true, result: {left: 90, top: NaN, right: 310, bottom: 310}});
      const tree = await mount();
      await press(tree, TEST_IDS.resize);
      const flat = Object.assign({}, ...[byId(tree, OVERLAY_TEST_IDS.referenceRect).props.style].flat());
      expect(flat).toMatchObject({left: 50, top: 50, width: 100, height: 100});
    });

    it('AC7.3 minimal input: counts and rect reads failing still allow a resize from natural bounds', async () => {
      api.getLassoElementTypeCounts.mockRejectedValue(new Error('no counts'));
      api.getLassoRect.mockResolvedValue({success: false});
      const tree = await mount();
      await press(tree, TEST_IDS.resize);
      const ref = byId(tree, OVERLAY_TEST_IDS.referenceRect);
      const flat = Object.assign({}, ...[ref.props.style].flat());
      // Natural bounds 100..300 page px → 50..150 dp at scale 2.
      expect(flat).toMatchObject({left: 50, top: 50, width: 100, height: 100});
      await gesture(tree, [100, 100], [300, 200]);
      expect(geometryNaturalBounds(lastModified())).toEqual({left: 200, top: 200, right: 600, bottom: 400});
    });

    it.each([
      ['an unsuccessful counts read', () => api.getLassoElementTypeCounts.mockResolvedValue({success: false})],
      ['a counts read with no result', () => api.getLassoElementTypeCounts.mockResolvedValue({success: true})],
      ['a malformed rect', () => api.getLassoRect.mockResolvedValue({success: true, result: {left: 1}})],
      ['a null rect', () => api.getLassoRect.mockResolvedValue({success: true, result: null})],
      ['a throwing rect read', () => api.getLassoRect.mockRejectedValue(new Error('rect'))],
    ])('AC7.3: %s degrades instead of blocking', async (_label, arrange) => {
      arrange();
      const tree = await mount();
      expect(has(tree, TEST_IDS.resize)).toBe(true);
    });

    it('AC7.6 mid-operation: unmounting while reads are pending updates nothing', async () => {
      let resolveGeometries: (v: unknown) => void = () => {};
      api.getLassoGeometries.mockReturnValue(new Promise(r => { resolveGeometries = r; }));
      let tree: ReactTestRenderer;
      act(() => {
        tree = create(<ShapeOptionsPanel scale={SCALE} />);
      });
      act(() => tree!.unmount());
      await act(async () => {
        resolveGeometries({success: true, result: [SQUARE]});
        await flushPromises();
      });
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('closing', () => {
    it.each([
      ['the ✕ button', TEST_IDS.close],
      ['a tap outside the panel', TEST_IDS.overlay],
    ])('AC7.7: %s closes without modifying', async (_label, id) => {
      const tree = await mount();
      await press(tree, id);
      expect(closeView).toHaveBeenCalledTimes(1);
      expect(api.modifyLassoGeometry).not.toHaveBeenCalled();
    });

    it('a tap inside the panel does not close', async () => {
      const tree = await mount();
      const stopPropagation = jest.fn();
      act(() => byId(tree, TEST_IDS.panel).props.onPress({stopPropagation}));
      expect(stopPropagation).toHaveBeenCalled();
      expect(closeView).not.toHaveBeenCalled();
    });

    it('AC7.7: ✕ in the resize hint closes without modifying', async () => {
      const tree = await mount();
      await press(tree, TEST_IDS.resize);
      const stopPropagation = jest.fn();
      act(() => byId(tree, TEST_IDS.resizeHint).props.onPress({stopPropagation}));
      expect(stopPropagation).toHaveBeenCalled();
      await press(tree, TEST_IDS.resizeCancel);
      expect(closeView).toHaveBeenCalledTimes(1);
      expect(api.modifyLassoGeometry).not.toHaveBeenCalled();
    });
  });

  describe('Resize freely', () => {
    it('AC7.4: shows the overlay with the current bounds outlined and a hint', async () => {
      const tree = await mount();
      await press(tree, TEST_IDS.resize);
      expect(has(tree, TEST_IDS.panel)).toBe(false);
      expect(has(tree, TEST_IDS.resizeHint)).toBe(true);
      const ref = byId(tree, OVERLAY_TEST_IDS.referenceRect);
      const flat = Object.assign({}, ...[ref.props.style].flat());
      expect(flat).toMatchObject({left: 45, top: 45, width: 110, height: 110});
    });

    it('AC7.4: a drag writes the stretched geometry once, keeps pen props, then closes', async () => {
      const tree = await mount();
      await press(tree, TEST_IDS.resize);
      await gesture(tree, [50, 60], [450, 110]);
      expect(api.modifyLassoGeometry).toHaveBeenCalledTimes(1);
      const out = lastModified();
      expect(geometryNaturalBounds(out)).toEqual({left: 100, top: 120, right: 900, bottom: 220});
      expect(out).toMatchObject({
        type: 'GEO_polygon', penColor: SQUARE.penColor, penType: SQUARE.penType, penWidth: SQUARE.penWidth,
      });
      expect(closeView).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[EDIT_SHAPE] modifyLassoGeometry', JSON.stringify({success: true, result: true}),
      );
    });

    it('lands on the dragged box even when a native resize is pending', async () => {
      api.getLassoRect.mockResolvedValue({success: true, result: {left: 0, top: 0, right: 900, bottom: 900}});
      const tree = await mount();
      await press(tree, TEST_IDS.resize);
      await gesture(tree, [100, 100], [200, 400]);
      expect(geometryNaturalBounds(lastModified())).toEqual({left: 200, top: 200, right: 400, bottom: 800});
    });

    it('AC5.3: a circle stretched unevenly is written as an ellipse', async () => {
      api.getLassoGeometries.mockResolvedValue({success: true, result: [CIRCLE]});
      const tree = await mount();
      await press(tree, TEST_IDS.resize);
      await gesture(tree, [100, 100], [500, 200]);
      const out = lastModified();
      expect(out.type).toBe('GEO_ellipse');
      expect(out.ellipseMajorAxisRadius).toBeCloseTo(400, 6);
      expect(out.ellipseMinorAxisRadius).toBeCloseTo(100, 6);
    });

    it('AC7.4/L: a tap does not resize but briefly hints to drag, then the hint returns', async () => {
      const tree = await mount();
      await press(tree, TEST_IDS.resize);
      expect(hintText(tree)).toBe(RESIZE_HINT);
      await gesture(tree, [100, 100], [100, 100]);
      expect(api.modifyLassoGeometry).not.toHaveBeenCalled();
      expect(closeView).not.toHaveBeenCalled();
      expect(hintText(tree)).toBe(TAP_HINT);
      act(() => { jest.advanceTimersByTime(2000); });
      expect(hintText(tree)).toBe(RESIZE_HINT);
    });

    it('E: success with result:false is a failure — banner, back to the panel, no close', async () => {
      api.modifyLassoGeometry.mockResolvedValueOnce({success: true, result: false});
      const tree = await mount();
      await press(tree, TEST_IDS.resize);
      await gesture(tree, [50, 50], [300, 100]);
      expect(closeView).not.toHaveBeenCalled();
      expect(has(tree, TEST_IDS.resize)).toBe(true);
      expect(byId(tree, TEST_IDS.error).findByType(Text).props.children).toBe('Resize failed');
    });

    it('D: ✕ is disabled and ignored while a modify is in flight', async () => {
      let resolveModify: (v: unknown) => void = () => {};
      api.modifyLassoGeometry.mockReturnValueOnce(new Promise(r => { resolveModify = r; }));
      const tree = await mount();
      await press(tree, TEST_IDS.resize);
      const o = byId(tree, OVERLAY_TEST_IDS.overlay).props;
      let pending: Promise<unknown> | undefined;
      await act(async () => {
        o.onResponderGrant(touch(50, 50));
        pending = o.onResponderRelease(touch(300, 100));
        await flushPromises();
      });
      expect(byId(tree, TEST_IDS.resizeCancel).props.disabled).toBe(true);
      await press(tree, TEST_IDS.resizeCancel);
      expect(closeView).not.toHaveBeenCalled();
      await act(async () => {
        resolveModify({success: false, error: {message: 'nope'}});
        await pending;
        await flushPromises();
      });
      // Back on the panel with the banner; closing works again.
      expect(byId(tree, TEST_IDS.close).props.disabled).toBe(false);
      await press(tree, TEST_IDS.close);
      expect(closeView).toHaveBeenCalledTimes(1);
    });

    it('AC7.5: a failed modify shows the firmware message, returns to the panel and stays open', async () => {
      api.modifyLassoGeometry.mockResolvedValueOnce({success: false, error: {message: 'X'}});
      const tree = await mount();
      await press(tree, TEST_IDS.resize);
      await gesture(tree, [50, 50], [300, 100]);
      expect(closeView).not.toHaveBeenCalled();
      expect(has(tree, TEST_IDS.resize)).toBe(true);
      expect(byId(tree, TEST_IDS.error).findByType(Text).props.children).toBe('X');
      act(() => { jest.advanceTimersByTime(2000); });
      expect(has(tree, TEST_IDS.error)).toBe(false);
    });

    it('AC7.5: an unsuccessful modify without a message falls back to "Resize failed"', async () => {
      api.modifyLassoGeometry.mockResolvedValueOnce(null);
      const tree = await mount();
      await press(tree, TEST_IDS.resize);
      await gesture(tree, [50, 50], [300, 100]);
      expect(byId(tree, TEST_IDS.error).findByType(Text).props.children)
        .toBe('Resize failed');
    });

    it('AC7.5: a throwing modify shows its message and a retry succeeds', async () => {
      api.modifyLassoGeometry.mockRejectedValueOnce(new Error('bridge down'));
      const tree = await mount();
      await press(tree, TEST_IDS.resize);
      await gesture(tree, [50, 50], [300, 100]);
      expect(byId(tree, TEST_IDS.error).findByType(Text).props.children)
        .toBe('bridge down');
      expect(closeView).not.toHaveBeenCalled();
      await press(tree, TEST_IDS.resize);
      expect(has(tree, TEST_IDS.error)).toBe(false);
      await gesture(tree, [50, 50], [300, 100]);
      expect(api.modifyLassoGeometry).toHaveBeenCalledTimes(2);
      expect(closeView).toHaveBeenCalledTimes(1);
    });

    it('a non-Error rejection falls back to "Resize failed"', async () => {
      api.modifyLassoGeometry.mockRejectedValueOnce('nope');
      const tree = await mount();
      await press(tree, TEST_IDS.resize);
      await gesture(tree, [50, 50], [300, 100]);
      expect(byId(tree, TEST_IDS.error).findByType(Text).props.children)
        .toBe('Resize failed');
    });

    it('AC7.6 mid-operation: a second release while modify is pending is ignored', async () => {
      let resolveModify: (v: unknown) => void = () => {};
      api.modifyLassoGeometry.mockReturnValueOnce(new Promise(r => { resolveModify = r; }));
      const tree = await mount();
      await press(tree, TEST_IDS.resize);
      const o = byId(tree, OVERLAY_TEST_IDS.overlay).props;
      let first: Promise<unknown> | undefined;
      await act(async () => {
        o.onResponderGrant(touch(50, 50));
        first = o.onResponderRelease(touch(300, 100));
        o.onResponderGrant(touch(60, 60));
        await o.onResponderRelease(touch(310, 110));
      });
      expect(api.modifyLassoGeometry).toHaveBeenCalledTimes(1);
      await act(async () => {
        resolveModify({success: true});
        await first;
        await flushPromises();
      });
      expect(closeView).toHaveBeenCalledTimes(1);
    });

    it('a geometry whose bounds cannot be determined reports "Can\'t resize this shape"', async () => {
      api.getLassoGeometries.mockResolvedValue({
        success: true, result: [{type: 'GEO_mystery', penColor: 0, penType: 10, penWidth: 300}],
      });
      api.getLassoRect.mockResolvedValue({success: true, result: LASSO_RECT});
      const tree = await mount();
      await press(tree, TEST_IDS.resize);
      await gesture(tree, [50, 50], [300, 100]);
      expect(api.modifyLassoGeometry).not.toHaveBeenCalled();
      expect(has(tree, TEST_IDS.resize)).toBe(true);
      expect(byId(tree, TEST_IDS.error).findByType(Text).props.children)
        .toBe("Can't resize this shape");
    });

    it('uses the resolved page size to clamp the drag', async () => {
      (PluginFileAPI.getPageSize as jest.Mock).mockResolvedValue({success: true, result: {width: 400, height: 400}});
      const tree = await mount();
      await press(tree, TEST_IDS.resize);
      await gesture(tree, [50, 50], [900, 900]);
      expect(geometryNaturalBounds(lastModified())).toEqual({left: 100, top: 100, right: 400, bottom: 400});
    });
  });

  describe('rendering details', () => {
    it('renders with no props (production mount path)', async () => {
      let tree: ReactTestRenderer;
      act(() => {
        tree = create(<ShapeOptionsPanel />);
      });
      await act(async () => { await flushPromises(); await flushPromises(); });
      expect(has(tree!, TEST_IDS.resize)).toBe(true);
    });

    it('every button shows a pressed state', async () => {
      const tree = await mount();
      for (const id of [TEST_IDS.close, TEST_IDS.resize]) {
        const style = byId(tree, id).props.style;
        expect([style({pressed: true})].flat(3)).toContainEqual({backgroundColor: '#F0F0F0'});
        expect([style({pressed: false})].flat(3)).not.toContainEqual({backgroundColor: '#F0F0F0'});
      }
      await press(tree, TEST_IDS.resize);
      const style = byId(tree, TEST_IDS.resizeCancel).props.style;
      expect([style({pressed: true})].flat(3)).toContainEqual({backgroundColor: '#F0F0F0'});
      expect([style({pressed: false})].flat(3)).not.toContainEqual({backgroundColor: '#F0F0F0'});
    });

    it('a second error restarts the banner timer, and unmount clears it', async () => {
      api.modifyLassoGeometry.mockResolvedValue({success: false, error: {message: 'first'}});
      const tree = await mount();
      await press(tree, TEST_IDS.resize);
      await gesture(tree, [50, 50], [300, 100]);
      act(() => { jest.advanceTimersByTime(1500); });
      api.modifyLassoGeometry.mockResolvedValue({success: false, error: {message: 'second'}});
      await press(tree, TEST_IDS.resize);
      await gesture(tree, [50, 50], [300, 100]);
      // The first timer would have cleared the banner at 2000 ms.
      act(() => { jest.advanceTimersByTime(1000); });
      expect(byId(tree, TEST_IDS.error).findByType(Text).props.children).toBe('second');
      const clearSpy = jest.spyOn(global, 'clearTimeout');
      act(() => tree.unmount());
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });
});
