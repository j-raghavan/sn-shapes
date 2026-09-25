/**
 * Tests for src/ResizeHandlesOverlay — the handles UI behind Edit Shape's
 * free resize (#17). Rendering of the box / line and its handles, the
 * gesture → edit wiring (throttle, release, terminate, busy) and the
 * Cancel / Done bar. The handle rules themselves live in
 * resizeHandles.test.ts.
 */
import React from 'react';
import {create, act, ReactTestRenderer} from 'react-test-renderer';
import {StyleSheet} from 'react-native';
import ResizeHandlesOverlay, {
  BAR_HEIGHT_DP,
  HANDLE_SIZE_DP,
  RESIZE_HINT,
  RESIZE_TEST_IDS,
} from '../src/ResizeHandlesOverlay';
import {RUBBER_BAND_THROTTLE_MS} from '../src/PlacementOverlay';
import {ResizeEdit} from '../src/resizeHandles';

const PAGE = {width: 1404, height: 1872};
const SCALE = 2;
// Page px; dp = {100, 200, 300, 400}.
const START: ResizeEdit = {kind: 'box', rect: {left: 200, top: 400, right: 600, bottom: 800}};

type Props = Partial<React.ComponentProps<typeof ResizeHandlesOverlay>>;

function mount(props: Props = {}) {
  const onCancel = jest.fn();
  const onDone = jest.fn();
  const element = (p: Props) => (
    <ResizeHandlesOverlay
      start={START}
      page={PAGE}
      scale={SCALE}
      busy={false}
      onCancel={onCancel}
      onDone={onDone}
      {...props}
      {...p}
    />
  );
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(element({}));
  });
  const byId = (testID: string) => tree!.root.findByProps({testID});
  const has = (testID: string) => tree!.root.findAllByProps({testID}).length > 0;
  const style = (testID: string) => StyleSheet.flatten(byId(testID).props.style);
  const overlay = () => byId(RESIZE_TEST_IDS.overlay).props;
  const rerender = (p: Props) => act(() => tree!.update(element(p)));
  return {tree: tree!, byId, has, style, overlay, rerender, onCancel, onDone};
}

function touch(x: number, y: number) {
  return {nativeEvent: {pageX: x, pageY: y}};
}

let now = 1_000;
let nowSpy: jest.SpyInstance;
beforeEach(() => {
  now = 1_000;
  nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  nowSpy.mockRestore();
});

describe('ResizeHandlesOverlay — rendering', () => {
  it('claims the responder on a non-collapsable view', () => {
    const {overlay} = mount();
    expect(overlay().collapsable).toBe(false);
    expect(overlay().onStartShouldSetResponder()).toBe(true);
  });

  it('draws the box and eight handles at dp positions', () => {
    const {style, has} = mount();
    expect(style(RESIZE_TEST_IDS.box)).toMatchObject({left: 100, top: 200, width: 200, height: 200});
    expect(has(RESIZE_TEST_IDS.segment)).toBe(false);
    const half = HANDLE_SIZE_DP / 2;
    const expected: Array<[string, number, number]> = [
      ['nw', 100, 200], ['n', 200, 200], ['ne', 300, 200], ['e', 300, 300],
      ['se', 300, 400], ['s', 200, 400], ['sw', 100, 400], ['w', 100, 300],
    ];
    for (const [h, x, y] of expected) {
      expect(style(RESIZE_TEST_IDS.handle(h as never))).toMatchObject({
        left: x - half, top: y - half, width: HANDLE_SIZE_DP, height: HANDLE_SIZE_DP,
      });
    }
  });

  it('handle and box views never take touches themselves', () => {
    const {byId} = mount();
    expect(byId(RESIZE_TEST_IDS.box).props.pointerEvents).toBe('none');
    expect(byId(RESIZE_TEST_IDS.handle('se')).props.pointerEvents).toBe('none');
  });

  it('draws a line as a rotated segment with two endpoint handles', () => {
    const line: ResizeEdit = {kind: 'line', from: {x: 200, y: 400}, to: {x: 400, y: 600}};
    const {style, has, byId} = mount({start: line});
    expect(has(RESIZE_TEST_IDS.box)).toBe(false);
    expect(has(RESIZE_TEST_IDS.handle('nw'))).toBe(false);
    const len = Math.hypot(100, 100);
    const seg = style(RESIZE_TEST_IDS.segment);
    expect(seg.width).toBeCloseTo(len, 6);
    expect(seg.left).toBeCloseTo(150 - len / 2, 6);
    expect(seg.top).toBeCloseTo(249, 6);
    expect(seg.transform).toEqual([{rotate: '45deg'}]);
    expect(byId(RESIZE_TEST_IDS.segment).props.pointerEvents).toBe('none');
    expect(style(RESIZE_TEST_IDS.handle('from'))).toMatchObject({left: 93, top: 193});
    expect(style(RESIZE_TEST_IDS.handle('to'))).toMatchObject({left: 193, top: 293});
  });

  it('shows the hint, or the parent\'s message instead', () => {
    const {byId, rerender} = mount();
    expect(byId(RESIZE_TEST_IDS.hint).props.children).toBe(RESIZE_HINT);
    rerender({message: 'Resize failed'});
    expect(byId(RESIZE_TEST_IDS.hint).props.children).toBe('Resize failed');
  });

  it('pins the bar to the top, or to the bottom when the shape sits under it', () => {
    const top = mount();
    expect(top.style(RESIZE_TEST_IDS.bar)).toMatchObject({top: 0, height: BAR_HEIGHT_DP});
    // dp top 50 < BAR_HEIGHT_DP + HANDLE_SIZE_DP.
    const high = mount({start: {kind: 'box', rect: {left: 200, top: 100, right: 600, bottom: 800}}});
    expect(high.style(RESIZE_TEST_IDS.bar)).toMatchObject({bottom: 0});
    expect(high.style(RESIZE_TEST_IDS.bar).top).toBeUndefined();
    const highLine = mount({start: {kind: 'line', from: {x: 200, y: 900}, to: {x: 400, y: 60}}});
    expect(highLine.style(RESIZE_TEST_IDS.bar)).toMatchObject({bottom: 0});
  });
});

describe('ResizeHandlesOverlay — gestures', () => {
  it('dragging the e handle moves only the right side; release lands exactly', () => {
    const {overlay, style} = mount();
    act(() => {
      overlay().onResponderGrant(touch(300, 300));
      overlay().onResponderMove(touch(350, 320));
    });
    expect(style(RESIZE_TEST_IDS.box)).toMatchObject({left: 100, top: 200, width: 250, height: 200});
    act(() => {
      overlay().onResponderRelease(touch(360, 330));
    });
    expect(style(RESIZE_TEST_IDS.box)).toMatchObject({left: 100, top: 200, width: 260, height: 200});
  });

  it('throttles moves to one render per interval; release is still exact', () => {
    const {overlay, style} = mount();
    act(() => {
      overlay().onResponderGrant(touch(300, 300));
      overlay().onResponderMove(touch(320, 300));
    });
    expect(style(RESIZE_TEST_IDS.box).width).toBe(220);
    now += RUBBER_BAND_THROTTLE_MS - 1;
    act(() => {
      overlay().onResponderMove(touch(340, 300));
    });
    expect(style(RESIZE_TEST_IDS.box).width).toBe(220);
    now += 1;
    act(() => {
      overlay().onResponderMove(touch(345, 300));
    });
    expect(style(RESIZE_TEST_IDS.box).width).toBe(245);
    act(() => {
      overlay().onResponderRelease(touch(340, 300));
    });
    expect(style(RESIZE_TEST_IDS.box).width).toBe(240);
  });

  it('a pen-down away from every handle is ignored until the next pen-down', () => {
    const {overlay, style} = mount();
    act(() => {
      overlay().onResponderGrant(touch(10, 800));
      overlay().onResponderMove(touch(400, 900));
      overlay().onResponderRelease(touch(400, 900));
    });
    expect(style(RESIZE_TEST_IDS.box)).toMatchObject({left: 100, top: 200, width: 200, height: 200});
  });

  it('dragging inside moves the box', () => {
    const {overlay, style} = mount();
    act(() => {
      overlay().onResponderGrant(touch(200, 300));
      overlay().onResponderRelease(touch(230, 310));
    });
    expect(style(RESIZE_TEST_IDS.box)).toMatchObject({left: 130, top: 210, width: 200, height: 200});
  });

  it('a terminated drag reverts to the box at pen-down', () => {
    const {overlay, style} = mount();
    act(() => {
      overlay().onResponderGrant(touch(300, 300));
      overlay().onResponderMove(touch(380, 300));
    });
    expect(style(RESIZE_TEST_IDS.box).width).toBe(280);
    act(() => {
      overlay().onResponderTerminate();
    });
    expect(style(RESIZE_TEST_IDS.box).width).toBe(200);
    // Terminate with nothing grabbed is a no-op.
    act(() => {
      overlay().onResponderTerminate();
    });
    expect(style(RESIZE_TEST_IDS.box).width).toBe(200);
  });

  it('drags a line endpoint', () => {
    const line: ResizeEdit = {kind: 'line', from: {x: 200, y: 400}, to: {x: 600, y: 400}};
    const {overlay, style} = mount({start: line});
    act(() => {
      overlay().onResponderGrant(touch(300, 200));
      overlay().onResponderRelease(touch(320, 240));
    });
    expect(style(RESIZE_TEST_IDS.handle('to'))).toMatchObject({left: 313, top: 233});
    expect(style(RESIZE_TEST_IDS.handle('from'))).toMatchObject({left: 93, top: 193});
  });

  it('while busy, pen-downs are ignored', () => {
    const {overlay, style} = mount({busy: true});
    act(() => {
      overlay().onResponderGrant(touch(300, 300));
      overlay().onResponderMove(touch(380, 300));
      overlay().onResponderRelease(touch(380, 300));
    });
    expect(style(RESIZE_TEST_IDS.box).width).toBe(200);
  });
});

describe('ResizeHandlesOverlay — bar', () => {
  it('Done hands the current edit to the parent; Cancel calls onCancel', () => {
    const {overlay, byId, onDone, onCancel} = mount();
    act(() => {
      overlay().onResponderGrant(touch(300, 400));
      overlay().onResponderRelease(touch(350, 450));
    });
    act(() => {
      byId(RESIZE_TEST_IDS.done).props.onPress();
    });
    expect(onDone).toHaveBeenCalledWith({kind: 'box', rect: {left: 200, top: 400, right: 700, bottom: 900}});
    act(() => {
      byId(RESIZE_TEST_IDS.cancel).props.onPress();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('both buttons are disabled while busy', () => {
    const {byId} = mount({busy: true});
    expect(byId(RESIZE_TEST_IDS.done).props.disabled).toBe(true);
    expect(byId(RESIZE_TEST_IDS.cancel).props.disabled).toBe(true);
  });

  it('the bar swallows its own presses', () => {
    const {byId} = mount();
    const stopPropagation = jest.fn();
    byId(RESIZE_TEST_IDS.bar).props.onPress({stopPropagation});
    expect(stopPropagation).toHaveBeenCalled();
  });

  it('button press styles invert when pressed', () => {
    const {byId} = mount();
    const styleFn = byId(RESIZE_TEST_IDS.done).props.style;
    expect(StyleSheet.flatten(styleFn({pressed: true})).backgroundColor).toBe('#F0F0F0');
    expect(StyleSheet.flatten(styleFn({pressed: false})).backgroundColor).toBeUndefined();
  });
});
