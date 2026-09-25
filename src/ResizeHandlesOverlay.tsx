/**
 * ResizeHandlesOverlay — the full-screen handles UI behind Edit Shape's
 * free resize (#17, ADR-FREE-RESIZE).
 *
 * Draws the edited box with eight handles (or a line with its two
 * endpoints) over the note, and a Cancel / Done bar. One responder owns
 * every touch: the pure `hitTest` picks the handle under the pen and
 * `dragHandle` computes the edit from the pen-down snapshot, so the handle
 * views themselves never take touches (`pointerEvents="none"`).
 *
 * Only the box moves while dragging; the shape itself is redrawn by the
 * firmware after Done. Moves re-render at most every
 * `RUBBER_BAND_THROTTLE_MS` for e-ink; release applies the exact final
 * position. The component knows nothing about geometry or the SDK: it
 * hands the final edit to `onDone`.
 */
import React, {useCallback, useRef, useState} from 'react';
import {GestureResponderEvent, Pressable, StyleSheet, Text, View} from 'react-native';
import {Point, Rect} from './lassoTransform';
import {PageSize, pageToTouch, touchToPage} from './placement';
import {boxStyle, RUBBER_BAND_THROTTLE_MS, touchPoint} from './PlacementOverlay';
import {dragHandle, Handle, hitTest, ResizeEdit} from './resizeHandles';

export const RESIZE_TEST_IDS = {
  overlay: 'resize-overlay',
  box: 'resize-box',
  segment: 'resize-segment',
  handle: (h: Handle) => `resize-handle-${h}`,
  bar: 'resize-bar',
  hint: 'resize-hint',
  cancel: 'resize-cancel',
  done: 'resize-done',
} as const;

export const RESIZE_HINT = 'Drag a handle to resize';
/** Filled black square centred on each handle point. */
export const HANDLE_SIZE_DP = 14;
export const BAR_HEIGHT_DP = 44;

export type ResizeHandlesOverlayProps = {
  /** The edit the handles open on, from `resizeFrame(...).start`. */
  start: ResizeEdit;
  page: PageSize;
  /** dp → page px multiplier (PixelRatio.get() on device). */
  scale: number;
  /** A write is in flight: gestures are ignored and both buttons disabled. */
  busy: boolean;
  /** Replaces the hint while set (errors); the parent owns its timer. */
  message?: string | null;
  onCancel: () => void;
  onDone: (edit: ResizeEdit) => void;
};

type Snapshot = {edit: ResizeEdit; down: Point; handle: Handle};

// Hoisted so the responder prop is referentially stable across renders.
const claimResponder = () => true;

const SEGMENT_WIDTH = 2;

/** Page-px rect → dp rect. */
function dpRect(r: Rect, scale: number): Rect {
  const a = pageToTouch({x: r.left, y: r.top}, scale);
  const b = pageToTouch({x: r.right, y: r.bottom}, scale);
  return {left: a.x, top: a.y, right: b.x, bottom: b.y};
}

/** The handle points of an edit, in dp. */
function handlePoints(edit: ResizeEdit, scale: number): Array<[Handle, Point]> {
  if (edit.kind === 'line') {
    return [['from', pageToTouch(edit.from, scale)], ['to', pageToTouch(edit.to, scale)]];
  }
  const {left, top, right, bottom} = edit.rect;
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;
  const pts: Array<[Handle, Point]> = [
    ['nw', {x: left, y: top}], ['n', {x: midX, y: top}], ['ne', {x: right, y: top}],
    ['e', {x: right, y: midY}], ['se', {x: right, y: bottom}], ['s', {x: midX, y: bottom}],
    ['sw', {x: left, y: bottom}], ['w', {x: left, y: midY}],
  ];
  return pts.map(([h, p]) => [h, pageToTouch(p, scale)]);
}

/** Top of the edit's drawn bounds, in dp. */
function topDp(edit: ResizeEdit, scale: number): number {
  const y = edit.kind === 'line' ? Math.min(edit.from.y, edit.to.y) : edit.rect.top;
  return pageToTouch({x: 0, y}, scale).y;
}

/** A 2 px segment from `a` to `b` (dp): a View rotated about its midpoint. */
function segmentStyle(a: Point, b: Point) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return {
    left: (a.x + b.x) / 2 - length / 2,
    top: (a.y + b.y) / 2 - SEGMENT_WIDTH / 2,
    width: length,
    transform: [{rotate: `${angle}deg`}],
  };
}

function buttonStyle({pressed}: {pressed: boolean}) {
  return [styles.button, pressed && styles.buttonPressed];
}

export default function ResizeHandlesOverlay({
  start,
  page,
  scale,
  busy,
  message,
  onCancel,
  onDone,
}: ResizeHandlesOverlayProps) {
  const [edit, setEdit] = useState<ResizeEdit>(start);
  // The pen-down snapshot never needs a re-render; the edit does.
  const snapRef = useRef<Snapshot | null>(null);
  const lastMoveAtRef = useRef(0);

  const handleGrant = useCallback(
    (e: GestureResponderEvent) => {
      snapRef.current = null;
      if (busy) {return;}
      const down = touchToPage(touchPoint(e), scale);
      const handle = hitTest(edit, down);
      if (!handle) {return;}
      snapRef.current = {edit, down, handle};
      lastMoveAtRef.current = 0;
    },
    [busy, edit, scale],
  );

  const editAt = useCallback(
    (snap: Snapshot, e: GestureResponderEvent) => {
      const now = touchToPage(touchPoint(e), scale);
      return dragHandle(snap.edit, snap.handle, {x: now.x - snap.down.x, y: now.y - snap.down.y}, page);
    },
    [page, scale],
  );

  const handleMove = useCallback(
    (e: GestureResponderEvent) => {
      const snap = snapRef.current;
      if (!snap) {return;}
      const t = Date.now();
      if (t - lastMoveAtRef.current < RUBBER_BAND_THROTTLE_MS) {return;}
      lastMoveAtRef.current = t;
      setEdit(editAt(snap, e));
    },
    [editAt],
  );

  const handleRelease = useCallback(
    (e: GestureResponderEvent) => {
      const snap = snapRef.current;
      if (!snap) {return;}
      snapRef.current = null;
      // Unthrottled: the final pen position always lands.
      setEdit(editAt(snap, e));
    },
    [editAt],
  );

  const handleTerminate = useCallback(() => {
    const snap = snapRef.current;
    if (!snap) {return;}
    snapRef.current = null;
    setEdit(snap.edit);
  }, []);

  // The bar moves to the bottom when the shape sits under it, so it never
  // covers a handle. Evaluated per render; the responder is already
  // granted, so a flip mid-drag cannot steal the gesture.
  const barAtBottom = topDp(edit, scale) < BAR_HEIGHT_DP + HANDLE_SIZE_DP;

  return (
    <View
      testID={RESIZE_TEST_IDS.overlay}
      style={styles.container}
      // A flattened (layout-only) View cannot own a responder on Android.
      collapsable={false}
      onStartShouldSetResponder={claimResponder}
      onResponderGrant={handleGrant}
      onResponderMove={handleMove}
      onResponderRelease={handleRelease}
      onResponderTerminate={handleTerminate}>
      {edit.kind === 'box' ? (
        <View
          testID={RESIZE_TEST_IDS.box}
          pointerEvents="none"
          style={[styles.box, boxStyle(dpRect(edit.rect, scale))]}
        />
      ) : (
        <View
          testID={RESIZE_TEST_IDS.segment}
          pointerEvents="none"
          style={[styles.segment, segmentStyle(pageToTouch(edit.from, scale), pageToTouch(edit.to, scale))]}
        />
      )}
      {handlePoints(edit, scale).map(([h, p]) => (
        <View
          key={h}
          testID={RESIZE_TEST_IDS.handle(h)}
          pointerEvents="none"
          style={[styles.handle, {left: p.x - HANDLE_SIZE_DP / 2, top: p.y - HANDLE_SIZE_DP / 2}]}
        />
      ))}
      {/* A Pressable swallows its own touches, so tapping the bar never
          starts a handle drag. */}
      <Pressable
        testID={RESIZE_TEST_IDS.bar}
        style={[styles.bar, barAtBottom ? styles.barBottom : styles.barTop]}
        onPress={ev => ev.stopPropagation()}>
        <Pressable
          testID={RESIZE_TEST_IDS.cancel}
          onPress={onCancel}
          disabled={busy}
          style={buttonStyle}>
          <Text style={styles.buttonText}>Cancel</Text>
        </Pressable>
        <Text testID={RESIZE_TEST_IDS.hint} style={styles.hintText}>{message ?? RESIZE_HINT}</Text>
        <Pressable
          testID={RESIZE_TEST_IDS.done}
          onPress={() => onDone(edit)}
          disabled={busy}
          style={buttonStyle}>
          <Text style={styles.buttonText}>Done</Text>
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  // Solid, not dashed: e-ink partial refresh drops dash segments.
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: '#000000',
  },
  segment: {
    position: 'absolute',
    height: SEGMENT_WIDTH,
    backgroundColor: '#000000',
  },
  handle: {
    position: 'absolute',
    width: HANDLE_SIZE_DP,
    height: HANDLE_SIZE_DP,
    backgroundColor: '#000000',
  },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: BAR_HEIGHT_DP,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    backgroundColor: '#FFFFFF',
  },
  barTop: {
    top: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
  },
  barBottom: {
    bottom: 0,
    borderTopWidth: 1,
    borderTopColor: '#000000',
  },
  hintText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
  },
  button: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#000000',
  },
  buttonPressed: {
    backgroundColor: '#F0F0F0',
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
  },
});
