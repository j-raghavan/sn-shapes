/**
 * ShapeOptionsPanel — Edit Shape's free resize behind the lasso-toolbar
 * Shapes button (id 200, #17, ADR-FREE-RESIZE).
 *
 * The firmware lasso handle keeps a shape's aspect ratio and scales its
 * stroke; the plugin cannot change that. This view opens straight into
 * resize handles on the lassoed shape instead: corners stretch both axes
 * freely, edges one axis, the inside moves it, a line gets its two
 * endpoints. Nothing is written until Done.
 *
 * Flow:
 *   1. On mount, read lasso counts, geometries and rect plus the page size
 *      in parallel. Until they resolve a Loading… card shows and no handle
 *      exists, so nothing can act on a half-read selection.
 *   2. Exactly one geometry and nothing else, with a resizable frame
 *      (`resizeFrame`) → the handles (`ResizeHandlesOverlay`). Otherwise a
 *      card says why. A failed counts read degrades to the geometry list;
 *      a failed rect read to the stored bounds.
 *   3. Done with the box unchanged, or Cancel, closes without writing. A
 *      changed box is remapped from the stored geometry (`applyResize`) and
 *      written with `modifyLassoGeometry`, re-sending every pen prop.
 *   4. Success closes the plugin view. Failure shows in the handles bar,
 *      keeps the handles where the user left them, and leaves the shape
 *      untouched, so Done can be retried.
 *
 * DEVICE-UNVERIFIED (ADR-FREE-RESIZE): where the handles open after a
 * native lasso resize (see the `[EDIT_SHAPE] frame` log); circle → ellipse.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {PluginCommAPI, PluginManager} from 'sn-plugin-lib';
import {
  Geometry,
  LassoCounts,
  Rect,
  countsAreUsable,
  isSingleGeometrySelection,
} from './lassoTransform';
import {ApiRes, TOUCH_SCALE, resolvePageSize} from './pageSize';
import {PageSize} from './placement';
import ResizeHandlesOverlay from './ResizeHandlesOverlay';
import {applyResize, editsEqual, ResizeEdit, ResizeFrame, resizeFrame} from './resizeHandles';

export const TEST_IDS = {
  // Outer full-screen Pressable behind a card (tap outside = close).
  overlay: 'edit-shape-overlay',
  card: 'edit-shape-card',
  close: 'edit-shape-close',
  loading: 'edit-shape-loading',
  unsupported: 'edit-shape-unsupported',
  unresizable: 'edit-shape-unresizable',
} as const;

export const UNSUPPORTED_MESSAGE = 'Select a single shape to resize.';
export const UNRESIZABLE_MESSAGE = "Can't resize this shape.";

const ERROR_DISPLAY_MS = 2000;

type State =
  | {mode: 'loading' | 'unsupported' | 'unresizable'}
  | {mode: 'resizing'; geometry: Geometry; frame: ResizeFrame; page: PageSize};

function isGeometry(x: unknown): x is Geometry {
  if (!x || typeof x !== 'object') {return false;}
  const g = x as Geometry;
  return (
    typeof g.type === 'string' &&
    typeof g.penColor === 'number' &&
    typeof g.penType === 'number' &&
    typeof g.penWidth === 'number'
  );
}

/**
 * Every lassoed geometry, or null on any API failure or malformed entry —
 * a list we cannot fully trust must not pass the single-shape check.
 */
async function readLassoGeometries(): Promise<Geometry[] | null> {
  try {
    const res = (await PluginCommAPI.getLassoGeometries()) as ApiRes<unknown>;
    if (!res?.success || !Array.isArray(res.result)) {return null;}
    return res.result.every(isGeometry) ? res.result : null;
  } catch (e) {
    console.error('[EDIT_SHAPE] getLassoGeometries failed:', e);
    return null;
  }
}

/** Current lasso box bounds (the visual size after any native resize), or null. */
async function readLassoRect(): Promise<Rect | null> {
  try {
    const res = (await PluginCommAPI.getLassoRect()) as ApiRes<Partial<Rect>>;
    if (!res?.success) {return null;}
    const r = res.result;
    // Any non-finite side (NaN included) → the caller falls back to the
    // geometry's natural bounds.
    if (!r || ![r.left, r.right, r.top, r.bottom].every(Number.isFinite)) {
      return null;
    }
    const {left, right, top, bottom} = r as Rect;
    return {left, right, top, bottom};
  } catch (e) {
    console.error('[EDIT_SHAPE] getLassoRect failed:', e);
    return null;
  }
}

/** Lasso element counts, logged so a device run shows what the firmware reports. */
async function readLassoCounts(): Promise<LassoCounts | null> {
  try {
    // The SDK's LassoElementTypeNum class has no index signature; read it loosely.
    const res = (await PluginCommAPI.getLassoElementTypeCounts()) as unknown as ApiRes<LassoCounts>;
    console.log('[EDIT_SHAPE] counts', JSON.stringify(res));
    return res?.success && res.result && typeof res.result === 'object' ? res.result : null;
  } catch (e) {
    console.error('[EDIT_SHAPE] getLassoElementTypeCounts failed:', e);
    return null;
  }
}

/** `scale` is a test seam; production uses the device's dp → px ratio. */
export type ShapeOptionsPanelProps = {scale?: number};

export default function ShapeOptionsPanel({scale = TOUCH_SCALE}: ShapeOptionsPanelProps) {
  const [state, setState] = useState<State>({mode: 'loading'});
  const [error, setError] = useState<string | null>(null);
  // busyRef is the synchronous guard (a second Done in the same tick);
  // `busy` drives the UI so the handles and buttons go inert meanwhile.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([readLassoCounts(), readLassoGeometries(), readLassoRect(), resolvePageSize()])
      .then(([counts, geometries, rect, page]) => {
        if (cancelled) {return;}
        if (!countsAreUsable(counts)) {
          console.warn('[EDIT_SHAPE] counts unavailable, falling back to geometry list');
        }
        if (!geometries || !isSingleGeometrySelection(counts, geometries.length)) {
          setState({mode: 'unsupported'});
          return;
        }
        const geometry = geometries[0];
        const frame = resizeFrame(geometry, rect);
        if (!frame) {
          setState({mode: 'unresizable'});
          return;
        }
        // Device probe for where the handles open (ADR-FREE-RESIZE).
        console.log('[EDIT_SHAPE] frame', JSON.stringify({
          natural: frame.stored, lassoRect: rect, pending: frame.pending, start: frame.start,
        }));
        setState({mode: 'resizing', geometry, frame, page});
      });
    return () => {
      cancelled = true;
      if (errorTimerRef.current) {clearTimeout(errorTimerRef.current);}
    };
  }, []);

  const showError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimerRef.current) {clearTimeout(errorTimerRef.current);}
    errorTimerRef.current = setTimeout(() => setError(null), ERROR_DISPLAY_MS);
  }, []);

  // Closing mid-modify would drop the result on the floor (no message if
  // it fails), so every close path is ignored while one is in flight.
  const close = useCallback(() => {
    if (busyRef.current) {return;}
    PluginManager.closePluginView();
  }, []);

  const handleDone = useCallback(async (geometry: Geometry, frame: ResizeFrame, edit: ResizeEdit) => {
    if (busyRef.current) {return;}
    // Unchanged: nothing to write, whatever the start-box estimate was.
    if (editsEqual(edit, frame.start)) {
      PluginManager.closePluginView();
      return;
    }
    const next = applyResize(geometry, edit);
    if (!next) {
      showError(UNRESIZABLE_MESSAGE);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      // The full geometry goes back, so pen props are re-sent with the
      // new coordinates rather than left to the firmware to carry over.
      const res = (await PluginCommAPI.modifyLassoGeometry(next)) as ApiRes<unknown>;
      // The SDK documents `result: false` as "update failed", even with
      // `success: true`.
      if (!res?.success || res.result === false) {
        showError(res?.error?.message ?? 'Resize failed');
        return;
      }
      console.log('[EDIT_SHAPE] modifyLassoGeometry', JSON.stringify(res));
      PluginManager.closePluginView();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Resize failed');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [showError]);

  if (state.mode === 'resizing') {
    const {geometry, frame} = state;
    return (
      <ResizeHandlesOverlay
        start={frame.start}
        page={state.page}
        scale={scale}
        busy={busy}
        message={error}
        onCancel={close}
        onDone={edit => handleDone(geometry, frame, edit)}
      />
    );
  }

  const cards = {
    loading: {testID: TEST_IDS.loading, text: 'Loading…'},
    unsupported: {testID: TEST_IDS.unsupported, text: UNSUPPORTED_MESSAGE},
    unresizable: {testID: TEST_IDS.unresizable, text: UNRESIZABLE_MESSAGE},
  };
  const card = cards[state.mode];
  return (
    <Pressable testID={TEST_IDS.overlay} style={styles.container} onPress={close}>
      <Pressable testID={TEST_IDS.card} style={styles.card} onPress={e => e.stopPropagation()}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Resize Shape</Text>
          <Pressable
            testID={TEST_IDS.close}
            onPress={close}
            style={({pressed}) => [styles.closeBtn, pressed && styles.closeBtnPressed]}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <View style={styles.divider} />
        <View testID={card.testID} style={styles.centerRow}>
          <Text style={styles.helperText}>{card.text}</Text>
        </View>
      </Pressable>
    </Pressable>
  );
}

const PANEL_PADDING = 10;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 280,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#000000',
  },
  headerRow: {
    paddingHorizontal: PANEL_PADDING,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000000',
  },
  closeBtn: {
    position: 'absolute',
    right: PANEL_PADDING,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnPressed: {
    backgroundColor: '#F0F0F0',
  },
  closeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#000000',
  },
  divider: {
    height: 1,
    backgroundColor: '#CCCCCC',
  },
  centerRow: {
    padding: 16,
    alignItems: 'center',
  },
  helperText: {
    fontSize: 13,
    color: '#555555',
    textAlign: 'center',
  },
});
