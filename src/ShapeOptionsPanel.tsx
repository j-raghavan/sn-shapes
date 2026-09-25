/**
 * ShapeOptionsPanel — the "Edit Shape" panel behind the lasso-toolbar
 * Shapes button (id 200, #17, ADR-FREE-RESIZE).
 *
 * The firmware lasso handle keeps a shape's aspect ratio and scales its
 * stroke; the plugin cannot change that. This panel offers the one thing
 * the handle cannot do — **Resize freely**: the user drags a new box and
 * the lassoed geometry is rewritten to fill it, at the same stroke width.
 *
 * Flow:
 *   1. On mount, read lasso counts, geometries and rect plus the page size
 *      in parallel. Until they resolve the panel shows Loading… and offers
 *      no action, so nothing can act on a half-read selection.
 *   2. Exactly one geometry and nothing else → Resize freely; anything else
 *      → "Select a single shape to resize." A failed counts read degrades
 *      to the geometry list; a failed rect read to the natural bounds.
 *   3. Resize freely swaps the panel for a full-screen PlacementOverlay
 *      that outlines the current bounds. A drag remaps the stored geometry
 *      onto the box (`resizeGeometryTo`) and writes it with
 *      `modifyLassoGeometry`, re-sending every pen prop. A tap is ignored.
 *   4. Success closes the plugin view. Failure returns to the panel with an
 *      error banner and leaves the shape untouched.
 *
 * DEVICE-UNVERIFIED (ADR-FREE-RESIZE): lasso stays active while the view is
 * open; modifyLassoGeometry keeps pen props and accepts circle → ellipse.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {PluginCommAPI, PluginManager} from 'sn-plugin-lib';
import {
  Geometry,
  LassoCounts,
  Rect,
  geometryNaturalBounds,
  isSingleGeometrySelection,
} from './lassoTransform';
import {
  ApiRes,
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  TOUCH_SCALE,
  resolvePageSize,
} from './pageSize';
import {PageSize, PlacementTarget, resizeGeometryTo} from './placement';
import PlacementOverlay from './PlacementOverlay';

export const TEST_IDS = {
  // Outer full-screen Pressable in panel mode (tap outside = close).
  overlay: 'edit-shape-overlay',
  panel: 'edit-shape-panel',
  close: 'edit-shape-close',
  loading: 'edit-shape-loading',
  unsupported: 'edit-shape-unsupported',
  resize: 'edit-shape-resize',
  resizeHint: 'edit-shape-resize-hint',
  resizeCancel: 'edit-shape-resize-cancel',
  error: 'edit-shape-error',
} as const;

export const UNSUPPORTED_MESSAGE = 'Select a single shape to resize.';

const ERROR_DISPLAY_MS = 2000;

type Mode = 'loading' | 'unsupported' | 'ready' | 'resizing';

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
    if (
      !r ||
      typeof r.left !== 'number' ||
      typeof r.right !== 'number' ||
      typeof r.top !== 'number' ||
      typeof r.bottom !== 'number'
    ) {
      return null;
    }
    return {left: r.left, right: r.right, top: r.top, bottom: r.bottom};
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
  const [mode, setMode] = useState<Mode>('loading');
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [lassoRect, setLassoRect] = useState<Rect | null>(null);
  const [page, setPage] = useState<PageSize>({width: DEFAULT_PAGE_WIDTH, height: DEFAULT_PAGE_HEIGHT});
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([readLassoCounts(), readLassoGeometries(), readLassoRect(), resolvePageSize()])
      .then(([counts, geometries, rect, size]) => {
        if (cancelled) {return;}
        setPage(size);
        setLassoRect(rect);
        if (geometries && isSingleGeometrySelection(counts, geometries.length)) {
          setGeometry(geometries[0]);
          setMode('ready');
        } else {
          setMode('unsupported');
        }
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

  const close = useCallback(() => {
    PluginManager.closePluginView();
  }, []);

  const startResize = useCallback(() => {
    setError(null);
    setMode('resizing');
  }, []);

  const handleResizeCommit = useCallback(async (target: PlacementTarget) => {
    // A tap has no box to stretch into; keep waiting for a drag.
    if (target.kind !== 'drag' || !geometry || busyRef.current) {return;}
    const next = resizeGeometryTo(geometry, target);
    if (!next) {
      showError("Can't resize this shape");
      setMode('ready');
      return;
    }
    busyRef.current = true;
    try {
      // The full geometry goes back, so pen props are re-sent with the
      // new coordinates rather than left to the firmware to carry over.
      const res = (await PluginCommAPI.modifyLassoGeometry(next)) as ApiRes<unknown>;
      if (!res?.success) {
        showError(res?.error?.message ?? 'Resize failed');
        setMode('ready');
        return;
      }
      console.log('[EDIT_SHAPE] modifyLassoGeometry', JSON.stringify(res));
      PluginManager.closePluginView();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Resize failed');
      setMode('ready');
    } finally {
      busyRef.current = false;
    }
  }, [geometry, showError]);

  if (mode === 'resizing' && geometry) {
    return (
      <PlacementOverlay
        page={page}
        scale={scale}
        onCommit={handleResizeCommit}
        referenceRect={lassoRect ?? geometryNaturalBounds(geometry)}>
        <Pressable
          testID={TEST_IDS.resizeHint}
          style={styles.hintBar}
          onPress={e => e.stopPropagation()}>
          <Text style={styles.hintText}>Drag a new box. Tap ✕ to cancel.</Text>
          <Pressable
            testID={TEST_IDS.resizeCancel}
            onPress={close}
            style={({pressed}) => [styles.closeBtn, pressed && styles.closeBtnPressed]}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </Pressable>
      </PlacementOverlay>
    );
  }

  return (
    <Pressable testID={TEST_IDS.overlay} style={styles.container} onPress={close}>
      <Pressable testID={TEST_IDS.panel} style={styles.panel} onPress={e => e.stopPropagation()}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Edit Shape</Text>
          <Pressable
            testID={TEST_IDS.close}
            onPress={close}
            style={({pressed}) => [styles.closeBtn, styles.headerClose, pressed && styles.closeBtnPressed]}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <View style={styles.divider} />

        {error && (
          <View testID={TEST_IDS.error} style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {mode === 'loading' && (
          <View testID={TEST_IDS.loading} style={styles.centerRow}>
            <Text style={styles.helperText}>Loading…</Text>
          </View>
        )}

        {mode === 'unsupported' && (
          <View testID={TEST_IDS.unsupported} style={styles.centerRow}>
            <Text style={styles.helperText}>{UNSUPPORTED_MESSAGE}</Text>
          </View>
        )}

        {mode === 'ready' && (
          <View style={styles.body}>
            <Pressable
              testID={TEST_IDS.resize}
              onPress={startResize}
              style={({pressed}) => [styles.actionBtn, pressed && styles.actionBtnPressed]}>
              <Text style={styles.actionText}>⤡  Resize freely</Text>
            </Pressable>
          </View>
        )}
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
  panel: {
    width: 280,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#000000',
    paddingBottom: PANEL_PADDING,
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
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerClose: {
    position: 'absolute',
    right: PANEL_PADDING,
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
  errorBanner: {
    marginHorizontal: PANEL_PADDING,
    marginTop: 5,
    backgroundColor: '#1A1A1A',
    borderRadius: 3,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: 12,
    textAlign: 'center',
  },
  body: {
    paddingHorizontal: PANEL_PADDING,
    paddingTop: PANEL_PADDING,
  },
  actionBtn: {
    paddingVertical: 10,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#000000',
    alignItems: 'center',
  },
  actionBtnPressed: {
    backgroundColor: '#F0F0F0',
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
  },
  // Hint bar pinned to the top of the resize overlay. A Pressable that
  // swallows its own touches so tapping it never reads as a tap-to-place.
  hintBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: PANEL_PADDING,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
  },
  hintText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
  },
});
