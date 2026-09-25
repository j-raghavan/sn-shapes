/**
 * Tests for src/ShapeOptionsPanel — Edit Shape's free resize behind the
 * lasso-toolbar Shapes button (#17, ADR-FREE-RESIZE). Covers the
 * loading → unsupported | unresizable | resizing state machine, where the
 * handles open, degradation when lasso reads fail, the Done →
 * modifyLassoGeometry path, and the failure / busy / unmount windows. The
 * handle rules live in resizeHandles.test.ts and the gesture wiring in
 * ResizeHandlesOverlay.test.tsx.
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

const LINE = {
  type: 'straightLine',
  penColor: 0x00,
  penType: 10,
  penWidth: 400,
  points: [{x: 100, y: 500}, {x: 400, y: 500}],
};

// Firmware reports the visual bounds: the vertices plus stroke padding.
const LASSO_RECT = {left: 90, top: 90, right: 310, bottom: 310};
const N = {left: 100, top: 100, right: 300, bottom: 300};

jest.mock('sn-plugin-lib', () => ({
  PluginCommAPI: {
    getLassoGeometries: jest.fn(),
    getLassoRect: jest.fn(),
    getLassoElementTypeCounts: jest.fn(),
    modifyLassoGeometry: jest.fn(),
    setLassoBoxState: jest.fn(),
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
  RESIZE_FAILED_MESSAGE,
  TEST_IDS,
  UNREADABLE_MESSAGE,
  UNRESIZABLE_MESSAGE,
  UNSUPPORTED_MESSAGE,
} from '../src/ShapeOptionsPanel';
import * as resizeHandles from '../src/resizeHandles';
import * as pageSize from '../src/pageSize';
import ResizeHandlesOverlay, {RESIZE_TEST_IDS} from '../src/ResizeHandlesOverlay';
import {geometryNaturalBounds, Geometry} from '../src/lassoTransform';
import {ResizeEdit} from '../src/resizeHandles';
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

const handles = (tree: ReactTestRenderer) => tree.root.findByType(ResizeHandlesOverlay).props;

async function done(tree: ReactTestRenderer, edit: ResizeEdit) {
  await act(async () => {
    handles(tree).onDone(edit);
    await flushPromises();
    await flushPromises();
  });
}

const box = (rect: typeof N): ResizeEdit => ({kind: 'box', rect});
const WIDER_RECT = {left: 100, top: 100, right: 500, bottom: 300};
const WIDER = box(WIDER_RECT);

/** The parsed payload of the `[EDIT_SHAPE] frame` log line. */
function frameLog(spy: jest.SpyInstance) {
  const call = spy.mock.calls.find(c => c[0] === '[EDIT_SHAPE] frame');
  return call ? JSON.parse(call[1]) : undefined;
}

function lastModified(): Geometry {
  const calls = api.modifyLassoGeometry.mock.calls;
  return calls[calls.length - 1][0];
}

let consoleErrorSpy: jest.SpyInstance;
let consoleLogSpy: jest.SpyInstance;
let consoleWarnSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  Object.values(api).forEach(m => m.mockReset());
  (PluginFileAPI.getPageSize as jest.Mock).mockReset();
  closeView.mockReset().mockResolvedValue(true);
  api.getLassoGeometries.mockResolvedValue({success: true, result: [SQUARE]});
  api.getLassoRect.mockResolvedValue({success: true, result: LASSO_RECT});
  api.getLassoElementTypeCounts.mockResolvedValue({success: true, result: {polygonNum: 1, geometryNum: 1}});
  api.modifyLassoGeometry.mockResolvedValue({success: true, result: true});
  api.setLassoBoxState.mockResolvedValue({success: true, result: true});
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
    it('mid-operation: a Loading… card and no handles until reads resolve', async () => {
      let resolveGeometries: (v: unknown) => void = () => {};
      api.getLassoGeometries.mockReturnValue(new Promise(r => { resolveGeometries = r; }));
      let tree: ReactTestRenderer;
      act(() => {
        tree = create(<ShapeOptionsPanel scale={SCALE} />);
      });
      await act(async () => { await flushPromises(); });
      expect(has(tree!, TEST_IDS.loading)).toBe(true);
      expect(has(tree!, RESIZE_TEST_IDS.overlay)).toBe(false);
      await act(async () => {
        resolveGeometries({success: true, result: [SQUARE]});
        await flushPromises();
      });
      expect(has(tree!, TEST_IDS.loading)).toBe(false);
      expect(has(tree!, RESIZE_TEST_IDS.overlay)).toBe(true);
    });

    it('a lone shape on a fresh lasso opens straight into handles on its stored bounds', async () => {
      const tree = await mount();
      expect(handles(tree).start).toEqual(box(N));
      expect(handles(tree).page).toEqual({width: 1404, height: 1872});
      expect(handles(tree).scale).toBe(SCALE);
      expect(has(tree, TEST_IDS.card)).toBe(false);
    });

    it('a pending native resize opens the handles on the lasso rect, inset', async () => {
      const lasso = {left: 80, top: 80, right: 420, bottom: 320};
      api.getLassoRect.mockResolvedValue({success: true, result: lasso});
      const tree = await mount();
      // penWidth 500 → tol 13 → inset 6.5 per side.
      expect(handles(tree).start).toEqual(box({left: 86.5, top: 86.5, right: 413.5, bottom: 313.5}));
      expect(frameLog(consoleLogSpy)).toEqual({
        natural: N, lassoRect: lasso, pending: true, start: handles(tree).start,
      });
    });

    it('logs the counts and the frame for device diagnosis', async () => {
      await mount();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[EDIT_SHAPE] counts', JSON.stringify({success: true, result: {polygonNum: 1, geometryNum: 1}}),
      );
      expect(frameLog(consoleLogSpy)).toEqual({
        natural: N, lassoRect: LASSO_RECT, pending: false, start: box(N),
      });
    });

    it('a line opens as a line edit on its endpoints', async () => {
      api.getLassoGeometries.mockResolvedValue({success: true, result: [LINE]});
      api.getLassoRect.mockResolvedValue({success: false});
      const tree = await mount();
      expect(handles(tree).start).toEqual({kind: 'line', from: {x: 100, y: 500}, to: {x: 400, y: 500}});
    });

    it.each([
      ['two geometries', () => api.getLassoGeometries.mockResolvedValue({success: true, result: [SQUARE, CIRCLE]})],
      ['a stroke in the selection', () =>
        api.getLassoElementTypeCounts.mockResolvedValue({success: true, result: {geometryNum: 1, trailNum: 2}})],
      ['a stroke and no geometryNum', () =>
        api.getLassoElementTypeCounts.mockResolvedValue({success: true, result: {trailNum: 4}})],
      ['no geometry', () => api.getLassoGeometries.mockResolvedValue({success: true, result: []})],
    ])('%s → "Select a single shape to resize."', async (_label, arrange) => {
      arrange();
      const tree = await mount();
      expect(has(tree, RESIZE_TEST_IDS.overlay)).toBe(false);
      expect(byId(tree, TEST_IDS.unsupported).findByType(Text).props.children).toBe(UNSUPPORTED_MESSAGE);
      expect(api.setLassoBoxState).not.toHaveBeenCalled();
    });

    it.each([
      ['a failed geometry read', () => api.getLassoGeometries.mockResolvedValue({success: false})],
      ['a throwing geometry read', () => api.getLassoGeometries.mockRejectedValue(new Error('bridge'))],
      ['a non-array result', () => api.getLassoGeometries.mockResolvedValue({success: true, result: {}})],
      ['a malformed geometry', () =>
        api.getLassoGeometries.mockResolvedValue({success: true, result: [{type: 'GEO_polygon'}]})],
      ['a null geometry entry', () => api.getLassoGeometries.mockResolvedValue({success: true, result: [null]})],
    ])('%s → "Couldn\'t read the lassoed shape."', async (_label, arrange) => {
      arrange();
      const tree = await mount();
      expect(has(tree, RESIZE_TEST_IDS.overlay)).toBe(false);
      expect(byId(tree, TEST_IDS.unreadable).findByType(Text).props.children).toBe(UNREADABLE_MESSAGE);
    });

    it('setup that throws shows "Can\'t resize this shape." and logs it', async () => {
      const spy = jest.spyOn(resizeHandles, 'resizeFrame').mockImplementation(() => {
        throw new Error('boom');
      });
      try {
        const tree = await mount();
        expect(byId(tree, TEST_IDS.unresizable).findByType(Text).props.children).toBe(UNRESIZABLE_MESSAGE);
        expect(consoleErrorSpy).toHaveBeenCalledWith('[EDIT_SHAPE] setup failed:', expect.any(Error));
      } finally {
        spy.mockRestore();
      }
    });

    it('setup that fails after unmount is logged but updates nothing', async () => {
      let reject: (e: Error) => void = () => {};
      const spy = jest.spyOn(pageSize, 'resolvePageSize').mockReturnValue(
        new Promise((_, r) => { reject = r; }),
      );
      try {
        let tree: ReactTestRenderer;
        act(() => {
          tree = create(<ShapeOptionsPanel scale={SCALE} />);
        });
        act(() => tree!.unmount());
        await act(async () => {
          reject(new Error('late'));
          await flushPromises();
        });
        expect(consoleErrorSpy).toHaveBeenCalledWith('[EDIT_SHAPE] setup failed:', expect.any(Error));
        expect(api.setLassoBoxState).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it.each([
      ['every point coincident', {...SQUARE, points: [{x: 5, y: 5}, {x: 5, y: 5}]}],
      ['an unknown geometry type', {...SQUARE, type: 'GEO_mystery'}],
    ])('a single shape with %s → "Can\'t resize this shape."', async (_label, g) => {
      api.getLassoGeometries.mockResolvedValue({success: true, result: [g]});
      const tree = await mount();
      expect(has(tree, RESIZE_TEST_IDS.overlay)).toBe(false);
      expect(byId(tree, TEST_IDS.unresizable).findByType(Text).props.children).toBe(UNRESIZABLE_MESSAGE);
    });

    it('unusable counts fall back to the geometry list and warn', async () => {
      api.getLassoElementTypeCounts.mockResolvedValue({success: true, result: {polygonNum: 1}});
      const tree = await mount();
      expect(has(tree, RESIZE_TEST_IDS.overlay)).toBe(true);
      expect(consoleWarnSpy).toHaveBeenCalledWith('[EDIT_SHAPE] counts unavailable, falling back to geometry list');
    });

    it('usable counts do not warn', async () => {
      await mount();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('a lasso rect with a NaN side degrades to the stored bounds', async () => {
      api.getLassoRect.mockResolvedValue({success: true, result: {left: 0, top: NaN, right: 900, bottom: 900}});
      const tree = await mount();
      expect(handles(tree).start).toEqual(box(N));
    });

    it('minimal input: counts and rect reads failing still open handles and resize', async () => {
      api.getLassoElementTypeCounts.mockRejectedValue(new Error('no counts'));
      api.getLassoRect.mockResolvedValue({success: false});
      const tree = await mount();
      expect(handles(tree).start).toEqual(box(N));
      await done(tree, WIDER);
      expect(geometryNaturalBounds(lastModified())).toEqual(WIDER_RECT);
    });

    it.each([
      ['an unsuccessful counts read', () => api.getLassoElementTypeCounts.mockResolvedValue({success: false})],
      ['a counts read with no result', () => api.getLassoElementTypeCounts.mockResolvedValue({success: true})],
      ['a malformed rect', () => api.getLassoRect.mockResolvedValue({success: true, result: {left: 1}})],
      ['a null rect', () => api.getLassoRect.mockResolvedValue({success: true, result: null})],
      ['a throwing rect read', () => api.getLassoRect.mockRejectedValue(new Error('rect'))],
    ])('%s degrades instead of blocking', async (_label, arrange) => {
      arrange();
      const tree = await mount();
      expect(has(tree, RESIZE_TEST_IDS.overlay)).toBe(true);
    });

    it('mid-operation: unmounting while reads are pending updates nothing', async () => {
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
      expect(closeView).not.toHaveBeenCalled();
    });
  });

  describe('closing', () => {
    it.each([
      ['the ✕ button', TEST_IDS.close],
      ['a tap outside the card', TEST_IDS.overlay],
    ])('%s closes without modifying', async (_label, id) => {
      api.getLassoGeometries.mockResolvedValue({success: true, result: [SQUARE, CIRCLE]});
      const tree = await mount();
      await press(tree, id);
      expect(closeView).toHaveBeenCalledTimes(1);
      expect(api.modifyLassoGeometry).not.toHaveBeenCalled();
    });

    it('✕ on the Loading… card closes (nothing has been written)', async () => {
      api.getLassoGeometries.mockReturnValue(new Promise(() => {}));
      const tree = await mount();
      await press(tree, TEST_IDS.close);
      expect(closeView).toHaveBeenCalledTimes(1);
    });

    it('a tap inside the card does not close', async () => {
      api.getLassoGeometries.mockResolvedValue({success: true, result: []});
      const tree = await mount();
      const stopPropagation = jest.fn();
      act(() => byId(tree, TEST_IDS.card).props.onPress({stopPropagation}));
      expect(stopPropagation).toHaveBeenCalled();
      expect(closeView).not.toHaveBeenCalled();
    });

    it('Cancel on the handles closes without modifying', async () => {
      const tree = await mount();
      await press(tree, RESIZE_TEST_IDS.cancel);
      expect(closeView).toHaveBeenCalledTimes(1);
      expect(api.modifyLassoGeometry).not.toHaveBeenCalled();
    });
  });

  describe('Done', () => {
    it('an unchanged box closes without writing', async () => {
      const tree = await mount();
      await press(tree, RESIZE_TEST_IDS.done);
      expect(api.modifyLassoGeometry).not.toHaveBeenCalled();
      expect(closeView).toHaveBeenCalledTimes(1);
    });

    it('a box within half a pixel of the start is unchanged too', async () => {
      const tree = await mount();
      await done(tree, box({...N, right: 300.4}));
      expect(api.modifyLassoGeometry).not.toHaveBeenCalled();
      expect(closeView).toHaveBeenCalledTimes(1);
    });

    it('a changed box writes the remapped geometry once with its pen props, then closes', async () => {
      const tree = await mount();
      await done(tree, WIDER);
      expect(api.modifyLassoGeometry).toHaveBeenCalledTimes(1);
      const g = lastModified();
      expect(g).toMatchObject({type: 'GEO_polygon', penColor: 0x9d, penType: 10, penWidth: 500});
      expect(geometryNaturalBounds(g)).toEqual(WIDER_RECT);
      expect(closeView).toHaveBeenCalledTimes(1);
      // Closing: stays busy so nothing else runs while the view goes away.
      expect(handles(tree).busy).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[EDIT_SHAPE] modifyLassoGeometry', JSON.stringify({success: true, result: true}),
      );
    });

    it('end to end: dragging the e handle then Done writes the wider shape', async () => {
      const tree = await mount();
      const overlay = () => byId(tree, RESIZE_TEST_IDS.overlay).props;
      // Stored bounds 100..300 page px → 50..150 dp at scale 2; e handle at (150, 100).
      act(() => {
        overlay().onResponderGrant({nativeEvent: {pageX: 150, pageY: 100}});
        overlay().onResponderRelease({nativeEvent: {pageX: 250, pageY: 100}});
      });
      await press(tree, RESIZE_TEST_IDS.done);
      expect(geometryNaturalBounds(lastModified())).toEqual(WIDER_RECT);
    });

    it('bakes a pending native resize: stored → edited box', async () => {
      api.getLassoRect.mockResolvedValue({success: true, result: {left: 80, top: 80, right: 420, bottom: 320}});
      const tree = await mount();
      const edited = {left: 86.5, top: 86.5, right: 600, bottom: 313.5};
      await done(tree, box(edited));
      expect(geometryNaturalBounds(lastModified())).toEqual(edited);
    });

    it('a circle stretched unevenly is written as an ellipse', async () => {
      api.getLassoGeometries.mockResolvedValue({success: true, result: [CIRCLE]});
      api.getLassoRect.mockResolvedValue({success: false});
      const tree = await mount();
      await done(tree, box({left: 0, top: 0, right: 400, bottom: 100}));
      expect(lastModified()).toMatchObject({type: 'GEO_ellipse', ellipseMajorAxisRadius: 200, ellipseMinorAxisRadius: 50});
    });

    it('a line writes its dragged endpoints', async () => {
      api.getLassoGeometries.mockResolvedValue({success: true, result: [LINE]});
      const tree = await mount();
      await done(tree, {kind: 'line', from: {x: 100, y: 500}, to: {x: 600, y: 200}});
      expect(lastModified().points).toEqual([{x: 100, y: 500}, {x: 600, y: 200}]);
      expect(lastModified().penWidth).toBe(400);
    });

    it('an edit that cannot be applied shows "Can\'t resize this shape." and keeps the handles', async () => {
      const tree = await mount();
      await done(tree, box({left: 300, top: 100, right: 100, bottom: 300}));
      expect(api.modifyLassoGeometry).not.toHaveBeenCalled();
      expect(handles(tree).message).toBe(UNRESIZABLE_MESSAGE);
      expect(closeView).not.toHaveBeenCalled();
    });
  });

  describe('write failures', () => {
    it.each([
      ['a long firmware message', {success: false, error: {message: 'E_LOCKED: the page is locked by sync '.repeat(4)}}],
      ['no message', {success: false}],
      ['success with result:false', {success: true, result: false}],
    ])('an unsuccessful modify with %s shows the short message, logs the full one, and stays open', async (_l, res) => {
      api.modifyLassoGeometry.mockResolvedValue(res);
      const tree = await mount();
      await done(tree, WIDER);
      expect(handles(tree).message).toBe(RESIZE_FAILED_MESSAGE);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[EDIT_SHAPE] modifyLassoGeometry failed:', JSON.stringify(res));
      expect(has(tree, RESIZE_TEST_IDS.overlay)).toBe(true);
      expect(closeView).not.toHaveBeenCalled();
    });

    it('a throwing modify shows the short message, logs the error, and a retry succeeds', async () => {
      const err = new Error('bridge down');
      api.modifyLassoGeometry.mockRejectedValueOnce(err);
      const tree = await mount();
      await done(tree, WIDER);
      expect(handles(tree).message).toBe(RESIZE_FAILED_MESSAGE);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[EDIT_SHAPE] modifyLassoGeometry failed:', err);
      await done(tree, WIDER);
      expect(api.modifyLassoGeometry).toHaveBeenCalledTimes(2);
      expect(closeView).toHaveBeenCalledTimes(1);
    });

    it('a non-Error rejection shows the short message too', async () => {
      api.modifyLassoGeometry.mockRejectedValueOnce('nope');
      const tree = await mount();
      await done(tree, WIDER);
      expect(handles(tree).message).toBe(RESIZE_FAILED_MESSAGE);
    });

    it('the message clears after 2 s; a second error restarts the timer; unmount clears it', async () => {
      api.modifyLassoGeometry.mockResolvedValue({success: false});
      const tree = await mount();
      await done(tree, WIDER);
      act(() => { jest.advanceTimersByTime(1500); });
      await done(tree, WIDER);
      // The first timer would have cleared the message at 2000 ms.
      act(() => { jest.advanceTimersByTime(1000); });
      expect(handles(tree).message).toBe(RESIZE_FAILED_MESSAGE);
      act(() => { jest.advanceTimersByTime(1000); });
      expect(handles(tree).message).toBeNull();
      await done(tree, WIDER);
      const clearSpy = jest.spyOn(global, 'clearTimeout');
      act(() => tree.unmount());
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });

  describe('while a write is in flight', () => {
    it('the handles go inert, and a second Done and Cancel are ignored', async () => {
      let resolveModify: (v: unknown) => void = () => {};
      api.modifyLassoGeometry.mockReturnValue(new Promise(r => { resolveModify = r; }));
      const tree = await mount();
      await done(tree, WIDER);
      expect(handles(tree).busy).toBe(true);
      await done(tree, box({left: 0, top: 0, right: 50, bottom: 50}));
      handles(tree).onCancel();
      expect(api.modifyLassoGeometry).toHaveBeenCalledTimes(1);
      expect(closeView).not.toHaveBeenCalled();
      await act(async () => {
        resolveModify({success: true, result: true});
        await flushPromises();
      });
      expect(closeView).toHaveBeenCalledTimes(1);
    });

    it('busy clears after a failure so Done can be retried', async () => {
      api.modifyLassoGeometry.mockResolvedValueOnce({success: false});
      const tree = await mount();
      await done(tree, WIDER);
      expect(handles(tree).busy).toBe(false);
    });
  });

  describe('firmware lasso box', () => {
    /** Every setLassoBoxState / closePluginView call, in order. */
    function calls(): string[] {
      const order: Array<[number, string]> = [
        ...api.setLassoBoxState.mock.calls.map((c, i) =>
          [api.setLassoBoxState.mock.invocationCallOrder[i], c[0] === 1 ? 'hide' : 'show'] as [number, string]),
        ...closeView.mock.invocationCallOrder.map(n => [n, 'close'] as [number, string]),
      ];
      return order.sort((a, b) => a[0] - b[0]).map(([, name]) => name);
    }

    it('is hidden when the handles come up and logged', async () => {
      await mount();
      expect(calls()).toEqual(['hide']);
      expect(consoleLogSpy).toHaveBeenCalledWith('[EDIT_SHAPE] lassoBox', 1, JSON.stringify({success: true, result: true}));
    });

    it('is shown again before Cancel closes the view', async () => {
      const tree = await mount();
      await press(tree, RESIZE_TEST_IDS.cancel);
      expect(calls()).toEqual(['hide', 'show', 'close']);
    });

    it('is shown again before an unchanged Done closes the view', async () => {
      const tree = await mount();
      await press(tree, RESIZE_TEST_IDS.done);
      expect(calls()).toEqual(['hide', 'show', 'close']);
    });

    it('is shown again before a successful write closes the view', async () => {
      const tree = await mount();
      await done(tree, WIDER);
      expect(calls()).toEqual(['hide', 'show', 'close']);
      expect(api.setLassoBoxState.mock.invocationCallOrder[1])
        .toBeGreaterThan(api.modifyLassoGeometry.mock.invocationCallOrder[0]);
    });

    it('stays hidden after a failed write (the handles are still up)', async () => {
      api.modifyLassoGeometry.mockResolvedValue({success: false});
      const tree = await mount();
      await done(tree, WIDER);
      expect(calls()).toEqual(['hide']);
    });

    it('is shown again on unmount, once', async () => {
      const tree = await mount();
      await press(tree, RESIZE_TEST_IDS.cancel);
      act(() => tree.unmount());
      expect(calls()).toEqual(['hide', 'show', 'close']);
      const other = await mount();
      act(() => other.unmount());
      expect(api.setLassoBoxState.mock.calls.map(c => c[0])).toEqual([1, 0, 1, 0]);
    });

    it('is never touched for a message card', async () => {
      api.getLassoGeometries.mockResolvedValue({success: true, result: []});
      const tree = await mount();
      await press(tree, TEST_IDS.overlay);
      expect(calls()).toEqual(['close']);
    });

    it('a rejected or throwing call is logged and never blocks', async () => {
      api.setLassoBoxState.mockRejectedValueOnce(new Error('no box'));
      const tree = await mount();
      expect(has(tree, RESIZE_TEST_IDS.overlay)).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[EDIT_SHAPE] setLassoBoxState failed:', expect.any(Error));
      api.setLassoBoxState.mockImplementationOnce(() => { throw new Error('sync'); });
      await press(tree, RESIZE_TEST_IDS.cancel);
      expect(closeView).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[EDIT_SHAPE] setLassoBoxState failed:', expect.objectContaining({message: 'sync'}));
    });
  });

  describe('rendering details', () => {
    it('renders with no props (production mount path)', async () => {
      let tree: ReactTestRenderer;
      act(() => {
        tree = create(<ShapeOptionsPanel />);
      });
      await act(async () => { await flushPromises(); await flushPromises(); });
      expect(has(tree!, RESIZE_TEST_IDS.overlay)).toBe(true);
    });

    it('uses the resolved page size', async () => {
      (PluginFileAPI.getPageSize as jest.Mock).mockResolvedValue({success: true, result: {width: 400, height: 400}});
      const tree = await mount();
      expect(handles(tree).page).toEqual({width: 400, height: 400});
    });

    it('the card ✕ shows a pressed state', async () => {
      api.getLassoGeometries.mockResolvedValue({success: true, result: []});
      const tree = await mount();
      const style = byId(tree, TEST_IDS.close).props.style;
      expect([style({pressed: true})].flat(3)).toContainEqual({backgroundColor: '#F0F0F0'});
      expect([style({pressed: false})].flat(3)).not.toContainEqual({backgroundColor: '#F0F0F0'});
    });
  });
});
