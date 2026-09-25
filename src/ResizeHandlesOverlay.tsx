/**
 * ResizeHandlesOverlay — the full-screen handles UI behind Edit Shape's
 * free resize (#17, ADR-FREE-RESIZE).
 *
 * Draws the edited box with eight handles (or a line with its two
 * endpoints) over the note, and a small Cancel / Done toolbar floating
 * next to the shape (`toolbarPlacement`), hidden while a handle is held.
 * One responder owns every other touch: the pure `hitTest` picks the
 * handle under the pen and `dragHandle` computes the edit from the pen-down
 * snapshot, so the handle views themselves never take touches
 * (`pointerEvents="none"`).
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
import {
  BoxHandle,
  boxHandles,
  dragHandle,
  Handle,
  HANDLE_HIT_PX,
  hitTest,
  ResizeEdit,
  toolbarPlacement,
} from './resizeHandles';

export const RESIZE_TEST_IDS = {
  overlay: 'resize-overlay',
  box: 'resize-box',
  segment: 'resize-segment',
  handle: (h: Handle) => `resize-handle-${h}`,
  // The floating Cancel / Done toolbar (named for the bar it replaced).
  bar: 'resize-bar',
  // The parent's message (errors), shown in the toolbar while set.
  hint: 'resize-hint',
  cancel: 'resize-cancel',
  done: 'resize-done',
} as const;

/** Filled black square centred on each handle point. */
export const HANDLE_SIZE_DP = 14;
export const TOOLBAR_WIDTH_DP = 160;
export const TOOLBAR_HEIGHT_DP = 40;
/** Extra toolbar height while a message line shows. */
export const TOOLBAR_MESSAGE_HEIGHT_DP = 20;

export type ResizeHandlesOverlayProps = {
  /** The edit the handles open on, from `resizeFrame(...).start`. */
  start: ResizeEdit;
  page: PageSize;
  /** dp → page px multiplier (PixelRatio.get() on device). */
  scale: number;
  /** A write is in flight: gestures are ignored and both buttons disabled. */
  busy: boolean;
  /** Shown in the toolbar while set (errors); the parent owns its timer. */
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

/** The handle points an edit offers (`boxHandles`), in dp. */
function handlePoints(edit: ResizeEdit, scale: number): Array<[Handle, Point]> {
  if (edit.kind === 'line') {
    return [['from', pageToTouch(edit.from, scale)], ['to', pageToTouch(edit.to, scale)]];
  }
  const {left, top, right, bottom} = edit.rect;
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;
  const pts: Array<[BoxHandle, Point]> = [
    ['nw', {x: left, y: top}], ['n', {x: midX, y: top}], ['ne', {x: right, y: top}],
    ['e', {x: right, y: midY}], ['se', {x: right, y: bottom}], ['s', {x: midX, y: bottom}],
    ['sw', {x: left, y: bottom}], ['w', {x: left, y: midY}],
  ];
  const offered = boxHandles(edit);
  return pts.filter(([h]) => offered.includes(h)).map(([h, p]) => [h, pageToTouch(p, scale)]);
}

/** The drawn bounds of an edit, in dp: the box, or a line's endpoints' box. */
function boundsDp(edit: ResizeEdit, scale: number): Rect {
  if (edit.kind === 'box') {return dpRect(edit.rect, scale);}
  const a = pageToTouch(edit.from, scale);
  const b = pageToTouch(edit.to, scale);
  return {
    left: Math.min(a.x, b.x), top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y),
  };
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
  // The toolbar hides while a handle is held: fewer e-ink redraws, and no
  // toolbar under the pen mid-drag. It reappears where the shape lands.
  const [dragging, setDragging] = useState(false);
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
      setDragging(true);
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
      setDragging(false);
    },
    [editAt],
  );

  const handleTerminate = useCallback(() => {
    const snap = snapRef.current;
    if (!snap) {return;}
    snapRef.current = null;
    setEdit(snap.edit);
    setDragging(false);
  }, []);

  const points = handlePoints(edit, scale);
  const toolbarSize = {
    width: TOOLBAR_WIDTH_DP,
    height: TOOLBAR_HEIGHT_DP + (message ? TOOLBAR_MESSAGE_HEIGHT_DP : 0),
  };
  const screen = pageToTouch({x: page.width, y: page.height}, scale);
  // Clear of both the drawn handle squares and the pen's hit area.
  const gap = Math.max(HANDLE_SIZE_DP, pageToTouch({x: HANDLE_HIT_PX, y: 0}, scale).x) + 4;
  const toolbarAt = toolbarPlacement(
    boundsDp(edit, scale), toolbarSize, {width: screen.x, height: screen.y}, gap,
  );

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
      {points.map(([h, p]) => (
        <View
          key={h}
          testID={RESIZE_TEST_IDS.handle(h)}
          pointerEvents="none"
          style={[styles.handle, {left: p.x - HANDLE_SIZE_DP / 2, top: p.y - HANDLE_SIZE_DP / 2}]}
        />
      ))}
      {/* A Pressable swallows its own touches, so tapping the toolbar never
          starts a handle drag; everywhere else the overlay hit-tests. */}
      {!dragging && (
        <Pressable
          testID={RESIZE_TEST_IDS.bar}
          style={[styles.toolbar, {...toolbarAt, width: toolbarSize.width, height: toolbarSize.height}]}
          onPress={ev => ev.stopPropagation()}>
          {message ? (
            <Text testID={RESIZE_TEST_IDS.hint} numberOfLines={1} style={styles.messageText}>{message}</Text>
          ) : null}
          <View style={styles.buttonRow}>
            <Pressable
              testID={RESIZE_TEST_IDS.cancel}
              onPress={onCancel}
              disabled={busy}
              style={buttonStyle}>
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
            <View style={styles.separator} />
            <Pressable
              testID={RESIZE_TEST_IDS.done}
              onPress={() => onDone(edit)}
              disabled={busy}
              style={buttonStyle}>
              <Text style={styles.buttonText}>Done</Text>
            </Pressable>
          </View>
        </Pressable>
      )}
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
  // Floating toolbar attached to the shape, like the firmware lasso one.
  toolbar: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: '#000000',
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  messageText: {
    height: TOOLBAR_MESSAGE_HEIGHT_DP,
    lineHeight: TOOLBAR_MESSAGE_HEIGHT_DP,
    fontSize: 12,
    textAlign: 'center',
    color: '#FFFFFF',
    backgroundColor: '#1A1A1A',
  },
  buttonRow: {
    flex: 1,
    flexDirection: 'row',
  },
  separator: {
    width: 1.5,
    backgroundColor: '#000000',
  },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
