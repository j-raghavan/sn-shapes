/**
 * Unit tests for src/PlacementOverlay — the responder View behind the
 * Shapes panel (issue #15, F2). Gesture → target wiring, rubber-band
 * visibility and its throttle. Geometry rules live in placement.test.ts.
 */
import React from 'react';
import {create, act, ReactTestRenderer} from 'react-test-renderer';
import {Text} from 'react-native';
import PlacementOverlay, {
  OVERLAY_TEST_IDS,
  RUBBER_BAND_THROTTLE_MS,
} from '../src/PlacementOverlay';
import {DRAG_THRESHOLD_PX, PlacementTarget} from '../src/placement';
import {Rect} from '../src/lassoTransform';

const PAGE = {width: 1404, height: 1872};
const SCALE = 2;

function touchEvent(x: number, y: number) {
  return {nativeEvent: {pageX: x, pageY: y}};
}

function mount(onCommit: (t: PlacementTarget) => void = () => {}, referenceRect?: Rect | null) {
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(
      <PlacementOverlay page={PAGE} scale={SCALE} onCommit={onCommit} referenceRect={referenceRect}>
        <Text testID="child">panel</Text>
      </PlacementOverlay>,
    );
  });
  const overlay = () => tree!.root.findByProps({testID: OVERLAY_TEST_IDS.overlay}).props;
  const band = () => tree!.root.findByProps({testID: OVERLAY_TEST_IDS.rubberBand});
  const hasBand = () => {
    try { band(); return true; } catch { return false; }
  };
  return {tree: tree!, overlay, band, hasBand};
}

let nowSpy: jest.SpyInstance;
beforeEach(() => {
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000);
});
afterEach(() => {
  nowSpy.mockRestore();
});

describe('PlacementOverlay', () => {
  it('renders its children inside the responder view and claims responder', () => {
    const {tree, overlay} = mount();
    expect(tree.root.findByProps({testID: 'child'})).toBeTruthy();
    expect(overlay().collapsable).toBe(false);
    expect(overlay().onStartShouldSetResponder()).toBe(true);
  });

  it('commits a tap target scaled into page px', () => {
    const onCommit = jest.fn();
    const {overlay} = mount(onCommit);
    act(() => {
      overlay().onResponderGrant(touchEvent(100, 200));
      overlay().onResponderRelease(touchEvent(100, 200));
    });
    expect(onCommit).toHaveBeenCalledWith({kind: 'tap', point: {x: 200, y: 400}});
  });

  it('commits a drag target scaled into page px', () => {
    const onCommit = jest.fn();
    const {overlay} = mount(onCommit);
    act(() => {
      overlay().onResponderGrant(touchEvent(100, 100));
      overlay().onResponderRelease(touchEvent(300, 500));
    });
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({kind: 'drag', rect: {left: 200, top: 200, right: 600, bottom: 1000}}),
    );
  });

  it('a release without a grant commits at the release point', () => {
    const onCommit = jest.fn();
    const {overlay} = mount(onCommit);
    act(() => { overlay().onResponderRelease(touchEvent(50, 60)); });
    expect(onCommit).toHaveBeenCalledWith({kind: 'tap', point: {x: 100, y: 120}});
  });

  it('a move without a grant is ignored', () => {
    const {overlay, hasBand} = mount();
    act(() => { overlay().onResponderMove(touchEvent(500, 500)); });
    expect(hasBand()).toBe(false);
  });

  it('shows a 2 px solid rubber band only past the threshold and clears it on release', () => {
    const {overlay, band, hasBand} = mount();
    act(() => { overlay().onResponderGrant(touchEvent(100, 100)); });
    expect(hasBand()).toBe(false);
    const sub = DRAG_THRESHOLD_PX / SCALE / 2;
    act(() => { overlay().onResponderMove(touchEvent(100 + sub, 100 + sub)); });
    expect(hasBand()).toBe(false);
    act(() => { overlay().onResponderMove(touchEvent(40, 300)); });
    const flat = Object.assign({}, ...[band().props.style].flat());
    expect(flat).toMatchObject({
      position: 'absolute', borderWidth: 2, borderStyle: 'solid',
      left: 40, top: 100, width: 60, height: 200,
    });
    expect(band().props.pointerEvents).toBe('none');
    act(() => { overlay().onResponderRelease(touchEvent(40, 300)); });
    expect(hasBand()).toBe(false);
  });

  it('clears the rubber band without committing when the gesture is terminated', () => {
    const onCommit = jest.fn();
    const {overlay, hasBand} = mount(onCommit);
    act(() => {
      overlay().onResponderGrant(touchEvent(100, 100));
      overlay().onResponderMove(touchEvent(400, 400));
    });
    expect(hasBand()).toBe(true);
    act(() => { overlay().onResponderTerminate(); });
    expect(hasBand()).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('throttles rubber-band updates to one per RUBBER_BAND_THROTTLE_MS', () => {
    const {overlay, band} = mount();
    const bandRect = () => {
      const f = Object.assign({}, ...[band().props.style].flat());
      return {left: f.left, top: f.top, width: f.width, height: f.height};
    };
    act(() => { overlay().onResponderGrant(touchEvent(100, 100)); });
    nowSpy.mockReturnValue(1_000);
    act(() => { overlay().onResponderMove(touchEvent(200, 200)); });
    expect(bandRect()).toEqual({left: 100, top: 100, width: 100, height: 100});
    // Inside the window: the band keeps its previous rect.
    nowSpy.mockReturnValue(1_000 + RUBBER_BAND_THROTTLE_MS - 1);
    act(() => { overlay().onResponderMove(touchEvent(300, 300)); });
    expect(bandRect()).toEqual({left: 100, top: 100, width: 100, height: 100});
    // Window elapsed: the band follows the pen again.
    nowSpy.mockReturnValue(1_000 + RUBBER_BAND_THROTTLE_MS);
    act(() => { overlay().onResponderMove(touchEvent(300, 300)); });
    expect(bandRect()).toEqual({left: 100, top: 100, width: 200, height: 200});
    // Dropping back under the threshold clears immediately, unthrottled.
    act(() => { overlay().onResponderMove(touchEvent(101, 101)); });
    expect(() => band()).toThrow();
  });

  it('a new grant resets the throttle window', () => {
    const {overlay, band} = mount();
    act(() => {
      overlay().onResponderGrant(touchEvent(100, 100));
      overlay().onResponderMove(touchEvent(200, 200));
      overlay().onResponderRelease(touchEvent(200, 200));
    });
    // Same timestamp as the previous band update — a fresh grant must
    // not inherit the old window.
    act(() => {
      overlay().onResponderGrant(touchEvent(10, 10));
      overlay().onResponderMove(touchEvent(60, 60));
    });
    const f = Object.assign({}, ...[band().props.style].flat());
    expect(f).toMatchObject({left: 10, top: 10, width: 50, height: 50});
  });

  describe('referenceRect (#17, FR6)', () => {
    // findAllByProps matches both the composite View and its host node.
    const reference = (tree: ReactTestRenderer) =>
      tree.root.findAllByProps({testID: OVERLAY_TEST_IDS.referenceRect});

    it('AC6.1: renders no outline without the prop', () => {
      expect(reference(mount().tree)).toHaveLength(0);
      expect(reference(mount(undefined, null).tree)).toHaveLength(0);
    });

    it('AC6.2: draws a static 1 px outline (distinct from the 2 px band) at the page rect in dp', () => {
      const {tree} = mount(undefined, {left: 200, top: 400, right: 600, bottom: 500});
      const [node] = reference(tree);
      expect(node.props.pointerEvents).toBe('none');
      const flat = Object.assign({}, ...[node.props.style].flat());
      expect(flat).toMatchObject({
        position: 'absolute', borderWidth: 1, borderStyle: 'solid',
        left: 100, top: 200, width: 200, height: 50,
      });
    });

    it('skips a non-finite rect', () => {
      expect(reference(mount(undefined, {left: 0, top: 0, right: NaN, bottom: 10}).tree)).toHaveLength(0);
    });

    it('AC6.2: the rubber band draws on top, and a drag still commits', () => {
      const onCommit = jest.fn();
      const {tree, overlay} = mount(onCommit, {left: 0, top: 0, right: 100, bottom: 100});
      act(() => {
        overlay().onResponderGrant(touchEvent(100, 100));
        overlay().onResponderMove(touchEvent(300, 300));
      });
      // Depth-first order == paint order among siblings.
      const ids = tree.root
        .findAll(n => [OVERLAY_TEST_IDS.referenceRect, OVERLAY_TEST_IDS.rubberBand]
          .includes(n.props.testID))
        .map(n => n.props.testID);
      expect(ids.indexOf(OVERLAY_TEST_IDS.referenceRect)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(OVERLAY_TEST_IDS.referenceRect))
        .toBeLessThan(ids.indexOf(OVERLAY_TEST_IDS.rubberBand));
      act(() => { overlay().onResponderRelease(touchEvent(300, 300)); });
      expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({kind: 'drag'}));
      expect(reference(tree).length).toBeGreaterThan(0);
    });
  });
});
