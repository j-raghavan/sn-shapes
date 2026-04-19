/**
 * ShapeOptionsPanel — Compact inline popover for the "Shape Options"
 * contextual lasso-toolbar button (id=200, registered in index.js).
 *
 * Flow:
 *   1. Opens when the user lassos a shape and taps Shape Options in the
 *      firmware's overflow menu. The plugin UI starts, App.tsx routes to
 *      this component (see pluginRouter).
 *   2. On mount, calls PluginCommAPI.getLassoGeometries() + getLassoRect()
 *      to read the current geometry and its lasso bounds (firmware keeps
 *      the lasso selection active while the plugin runs, confirmed via
 *      logcat line 28760 sendMenuItemEvent).
 *   3. Renders a StrokePreview at the top (shape name + sample stroke that
 *      reflects the currently-effective width/color/type), then three
 *      picker sections — Stroke Width, Stroke Color, Pen Type — and a
 *      destructive Delete button. Picker taps update a local "pending
 *      patch" instead of firing modifyLassoGeometry immediately — that way
 *      the user can adjust multiple properties in one session and commit
 *      them atomically. Tapping the overlay (outside the popup) or the ✕
 *      close button commits the pending patch via modifyLassoGeometry and
 *      closes. Tapping Delete calls deleteLassoElements() immediately
 *      (destructive actions bypass deferred-apply).
 *   4. On modify/delete success the plugin view is closed via
 *      PluginManager.closePluginView(). On error the banner shows and the
 *      panel stays open so the user can retry or change selection.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {View, Text, Pressable, StyleSheet, ViewStyle} from 'react-native';
import {PluginCommAPI, PluginManager} from 'sn-plugin-lib';
import {bakeLassoResize, Rect} from './lassoTransform';
import StrokePreview from './StrokePreview';

export const TEST_IDS = {
  overlay: 'shape-options-overlay',
  widthButton: (w: number) => `shape-options-width-${w}`,
  colorButton: (c: number) => `shape-options-color-${c}`,
  penTypeButton: (t: number) => `shape-options-pentype-${t}`,
  delete: 'shape-options-delete',
  error: 'shape-options-error',
  loading: 'shape-options-loading',
  empty: 'shape-options-empty',
} as const;

// Firmware floor for penWidth. GeometrySchema in
// node_modules/sn-plugin-lib/src/sdk/utils/VerifyUtils.ts line 523 enforces
// `penWidth: { type: 'number', min: 100, required: true }`. Any value below
// this gets rejected by the native bridge with a verify error. We expose
// this as a named constant (and enforce it in `handleWidthPress` via
// `isAcceptablePenWidth`) so no code path inside this panel can ever push
// a sub-100 value into the pending patch — belt-and-suspenders on top of
// the preset list.
export const MIN_PEN_WIDTH = 100;

/**
 * True iff `value` is a finite number at or above the firmware's penWidth
 * floor. Pure so that the guard can be unit-tested directly without
 * rendering the component.
 */
export function isAcceptablePenWidth(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_PEN_WIDTH
  );
}

// Pen-width presets. GeometrySchema.penWidth requires min: MIN_PEN_WIDTH;
// units are micrometres so `penWidth / 1000 = mm`. We expose 5 ticks
// labelled XS/S/M/L/XL — even spacing across the firmware-supported
// range (0.10, 0.30, 0.50, 0.70, 0.90 mm).
//
// 2026-04-18 history note: this was a 9-tick list (every 0.10 mm), but
// per user direction we collapsed to 5 sizes to match the 5-color row's
// layout pattern and reduce decision overhead. T-shirt sizes read more
// naturally than raw mm at-a-glance for a quick "make this thicker"
// choice — exact mm is still surfaced via formatPenWidthMm in the
// preview meta row so power users can confirm the absolute value.
export const WIDTH_PRESETS: ReadonlyArray<{value: number; mm: number; label: string}> = [
  {value: 100, mm: 0.10, label: 'XS'},
  {value: 300, mm: 0.30, label: 'S'},
  {value: 500, mm: 0.50, label: 'M'},
  {value: 700, mm: 0.70, label: 'L'},
  {value: 900, mm: 0.90, label: 'XL'},
];

export function formatPenWidthMm(penWidth: number | undefined): string {
  if (typeof penWidth !== 'number' || !Number.isFinite(penWidth)) {return '—';}
  return `${(penWidth / 1000).toFixed(2)} mm`;
}

// Pen-color presets. The Supernote firmware enforces an allow-list of
// penColor values on the native side (see
// node_modules/sn-plugin-lib/android/.../constant/Constant.java → PEN_COLORS):
//   [0xFE, 0x9D, 0x9E, 0xC9, 202 (0xCA), 0, 255, -101, -102, 1]
// Anything not in that list (e.g. 0x80, 0x9A, 0xC8) is rejected by the
// native bridge with an "Invalid color value. Cannot call the API" toast.
// The non-gray values in the allow-list (`1` is a marker-type sentinel per
// the Chinese comment in Constant.java line 55; signed bytes -101/-102 are
// platform artefacts) aren't meaningful as user-facing colors on the Nomad's
// greyscale e-ink. We surface 5 ALLOW-LISTED gray levels here. Note that
// 0x9D ↔ 0x9E and 0xC9 ↔ 0xCA differ by only one density unit each, so the
// "Dark"/"Dark+" and "Light"/"Light+" pairs render very similarly on-device
// — we expose both because they're the only valid mid-gray slots the
// firmware accepts. We omit true white (0xFE / 0xFF / 255) since a white
// stroke on white paper would be invisible and would only confuse users.
//
// Historical note: an earlier version had 0x9A in the "Dark+" slot; it
// looked correct on the simulator but the on-device firmware rejected it
// with the "Invalid color" toast. Replaced with 0x9E (the closest valid
// mid-gray) on 2026-04-18 — see user report on v1.0.2 alpha 4.
export const COLOR_PRESETS: ReadonlyArray<{value: number; label: string; swatch: string}> = [
  {value: 0x00, label: 'Black', swatch: '#000000'},
  {value: 0x9D, label: 'Dark+', swatch: '#5A5A5A'},
  {value: 0x9E, label: 'Dark', swatch: '#7A7A7A'},
  {value: 0xC9, label: 'Light', swatch: '#B0B0B0'},
  {value: 0xCA, label: 'Light+', swatch: '#CCCCCC'},
];

// Convert a firmware penColor byte into a CSS-ish #RRGGBB for on-screen
// preview rendering. The Nomad renders these as grayscale, but the raw byte
// is the ink DENSITY (0 = solid black, 0xFE/0xFF = white). Our swatch hex
// above is tuned to approximate how the density renders in practice, not the
// raw byte value (e.g. 0x9D stores as density 157 but visually reads darker
// than #9D9D9D on e-ink, so our swatch is #7A7A7A). For arbitrary inputs not
// in the presets we fall back to the raw grayscale.
export function penColorToSwatch(penColor: number | undefined): string {
  if (typeof penColor !== 'number' || !Number.isFinite(penColor)) {return '#000000';}
  const preset = COLOR_PRESETS.find(c => c.value === penColor);
  if (preset) {return preset.swatch;}
  // Fallback: map the byte to an on-screen grayscale.
  const clamped = Math.max(0, Math.min(255, Math.round(penColor)));
  const hex = clamped.toString(16).padStart(2, '0').toUpperCase();
  return `#${hex}${hex}${hex}`;
}

// Pen-type presets. Values come from the firmware allow-list in
// Constant.java → PEN_TYPES, documented on Element.ts line 735:
//   `10=fineliner, 1=pressure pen, 11=marker, 14=Calligraphy`
// Order here matches the sidebar pen order on Nomad so the mental model
// transfers 1:1 from the main drawing surface.
export const PEN_TYPE_PRESETS: ReadonlyArray<{value: number; label: string}> = [
  {value: 10, label: 'Fineliner'},
  {value: 1, label: 'Pressure'},
  {value: 11, label: 'Marker'},
  {value: 14, label: 'Calligraphy'},
];

// Human-friendly name for a Geometry.type, used as the preview header. The
// four types come from Geometry.TYPE_* in Element.ts line 836–839 and the
// Constant.java GEO_TYPES allow-list.
export const SHAPE_DISPLAY_NAMES: Record<string, string> = {
  straightLine: 'Line',
  GEO_circle: 'Circle',
  GEO_ellipse: 'Ellipse',
  GEO_polygon: 'Polygon',
};

export function shapeDisplayName(type: string | undefined): string {
  if (!type) {return 'Shape';}
  return SHAPE_DISPLAY_NAMES[type] ?? 'Shape';
}

const ERROR_DISPLAY_MS = 2000;

type Geometry = {
  type: string;
  penColor: number;
  penType: number;
  penWidth: number;
  [extra: string]: unknown;
};

async function readFirstLassoGeometry(): Promise<Geometry | null> {
  try {
    const res = (await PluginCommAPI.getLassoGeometries()) as
      | {success: boolean; result?: unknown}
      | null
      | undefined;
    if (!res?.success) {return null;}
    const list = res.result;
    if (!Array.isArray(list) || list.length === 0) {return null;}
    const first = list[0];
    if (!first || typeof first !== 'object') {return null;}
    const g = first as Geometry;
    if (
      typeof g.type !== 'string' ||
      typeof g.penColor !== 'number' ||
      typeof g.penType !== 'number' ||
      typeof g.penWidth !== 'number'
    ) {
      return null;
    }
    return g;
  } catch (e) {
    console.error('[ShapeOptionsPanel] getLassoGeometries failed:', e);
    return null;
  }
}

/**
 * Reads the current lasso box bounds. The lasso rect is the "visual" size
 * the user sees after any native resize gesture, and differs from the
 * geometry's own stored coordinates when a resize is pending. Returns null
 * on any API or shape failure — callers should fall back to modifying
 * without a resize bake (i.e. v1.0.1 behavior).
 */
async function readLassoRect(): Promise<Rect | null> {
  try {
    const res = (await PluginCommAPI.getLassoRect()) as
      | {success: boolean; result?: unknown}
      | null
      | undefined;
    if (!res?.success) {return null;}
    const r = res.result as Partial<Rect> | null | undefined;
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
    console.error('[ShapeOptionsPanel] getLassoRect failed:', e);
    return null;
  }
}

type PendingPatch = Partial<Pick<Geometry, 'penWidth' | 'penColor' | 'penType'>>;

/**
 * Visual approximation of each pen type for the picker buttons. The true
 * rendering happens in firmware so we can only hint at the difference: a
 * fineliner is thin & uniform; a pressure pen is slightly thicker with
 * rounded ends; a marker is fat and translucent; calligraphy gets a slight
 * skew. Always renders in solid black so the picker shows TYPE differences
 * — colour is communicated separately by the StrokePreview at the top.
 */
export function penTypeStrokeStyle(penType: number): ViewStyle {
  switch (penType) {
    case 1: // Pressure pen — slightly tapered feel via rounded ends
      return {height: 3, opacity: 1, borderRadius: 1.5};
    case 11: // Marker — thick + translucent
      return {height: 7, opacity: 0.55};
    case 14: // Calligraphy — angled
      return {height: 4, opacity: 1, transform: [{skewX: '-15deg'}]};
    case 10: // Fineliner — thin uniform (also the default fallback)
    default:
      return {height: 2, opacity: 1};
  }
}

export default function ShapeOptionsPanel() {
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [lassoRect, setLassoRect] = useState<Rect | null>(null);
  const [pendingPatch, setPendingPatch] = useState<PendingPatch>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Read geometry and lasso rect in parallel. Either can be null; we
    // tolerate missing rect by just not baking (falls back to v1.0.1).
    Promise.all([readFirstLassoGeometry(), readLassoRect()]).then(([g, r]) => {
      setGeometry(g);
      setLassoRect(r);
      setLoading(false);
    });
    return () => {
      if (errorTimerRef.current) {clearTimeout(errorTimerRef.current);}
    };
  }, []);

  const showError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimerRef.current) {clearTimeout(errorTimerRef.current);}
    errorTimerRef.current = setTimeout(() => setError(null), ERROR_DISPLAY_MS);
  }, []);

  // Effective values shown as "selected" in the UI and fed to StrokePreview.
  // Unset fields fall back to the geometry's current value so the initial
  // render mirrors the shape's actual state before the user picks anything.
  const effectiveWidth = pendingPatch.penWidth ?? geometry?.penWidth;
  const effectiveColor = pendingPatch.penColor ?? geometry?.penColor;
  const effectivePenType = pendingPatch.penType ?? geometry?.penType;

  /**
   * Filter the pending patch to only fields that actually differ from the
   * geometry. Avoids sending a no-op modifyLassoGeometry just because the
   * user re-tapped the already-selected option.
   */
  const computeRealChanges = useCallback(
    (g: Geometry, patch: PendingPatch): PendingPatch => {
      const out: PendingPatch = {};
      if (patch.penWidth != null && patch.penWidth !== g.penWidth) {
        out.penWidth = patch.penWidth;
      }
      if (patch.penColor != null && patch.penColor !== g.penColor) {
        out.penColor = patch.penColor;
      }
      if (patch.penType != null && patch.penType !== g.penType) {
        out.penType = patch.penType;
      }
      return out;
    },
    [],
  );

  const commitAndClose = useCallback(async () => {
    if (busyRef.current) {return;}
    // Nothing loaded yet (still in loading state) — just close.
    if (!geometry) {
      PluginManager.closePluginView();
      return;
    }
    const realChanges = computeRealChanges(geometry as Geometry, pendingPatch);
    if (Object.keys(realChanges).length === 0) {
      // No real changes — close without calling modify.
      PluginManager.closePluginView();
      return;
    }
    busyRef.current = true;
    setError(null);
    try {
      // Bake any pending lasso-resize into the geometry's own coordinates
      // BEFORE merging the pen patch. Without this, modifyLassoGeometry
      // sees the stored (pre-resize) geometry and the firmware discards
      // the user's resize, snapping the shape back to its insert-time
      // size. `bakeLassoResize` is a no-op when lassoRect is null, when it
      // matches the natural bounds within the penWidth-aware tolerance, or
      // when the geometry type is unknown — so this is safe on devices or
      // flows where the rect API isn't available.
      const baked = bakeLassoResize(geometry as Geometry, lassoRect);
      const merged: Geometry = {...baked, ...realChanges};
      const res = await PluginCommAPI.modifyLassoGeometry(merged);
      const success =
        res != null && typeof res === 'object' && (res as any).success === true;
      if (!success) {
        const msg = (res as any)?.error?.message ?? 'Modify failed';
        showError(msg);
        return;
      }
      PluginManager.closePluginView();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Modify failed');
    } finally {
      busyRef.current = false;
    }
  }, [geometry, lassoRect, pendingPatch, computeRealChanges, showError]);

  const handleWidthPress = useCallback((value: number) => {
    if (busyRef.current) {return;}
    // Defense-in-depth: GeometrySchema.penWidth has min=MIN_PEN_WIDTH on
    // the native bridge. Reject anything below that here so a stray
    // caller (or a future edit to WIDTH_PRESETS) can never produce a
    // verify error from modifyLassoGeometry. Non-finite values are also
    // dropped — the presets are integers, so anything else is a bug.
    if (!isAcceptablePenWidth(value)) {return;}
    setPendingPatch(prev => ({...prev, penWidth: value}));
  }, []);

  const handleColorPress = useCallback((value: number) => {
    if (busyRef.current) {return;}
    setPendingPatch(prev => ({...prev, penColor: value}));
  }, []);

  const handlePenTypePress = useCallback((value: number) => {
    if (busyRef.current) {return;}
    setPendingPatch(prev => ({...prev, penType: value}));
  }, []);

  const handleDelete = useCallback(async () => {
    if (busyRef.current) {return;}
    busyRef.current = true;
    setError(null);
    try {
      const res = await PluginCommAPI.deleteLassoElements();
      const success =
        res != null && typeof res === 'object' && (res as any).success === true;
      if (!success) {
        const msg = (res as any)?.error?.message ?? 'Delete failed';
        showError(msg);
        return;
      }
      PluginManager.closePluginView();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      busyRef.current = false;
    }
  }, [showError]);

  const handleOverlayPress = commitAndClose;
  const close = commitAndClose;

  return (
    <Pressable testID={TEST_IDS.overlay} style={styles.container} onPress={handleOverlayPress}>
      <Pressable style={styles.panel} onPress={e => e.stopPropagation()}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Shape Options</Text>
          <Pressable
            onPress={close}
            style={({pressed}) => [styles.closeBtn, pressed && styles.closeBtnPressed]}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <View style={styles.divider} />

        {loading && (
          <View testID={TEST_IDS.loading} style={styles.centerRow}>
            <Text style={styles.helperText}>Loading…</Text>
          </View>
        )}

        {!loading && !geometry && (
          <View testID={TEST_IDS.empty} style={styles.centerRow}>
            <Text style={styles.helperText}>No shape selected</Text>
          </View>
        )}

        {error && (
          <View testID={TEST_IDS.error} style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!loading && geometry && (
          <View style={styles.body}>
            <StrokePreview
              shapeType={geometry.type}
              penWidth={effectiveWidth}
              penColor={effectiveColor}
              penType={effectivePenType}
            />

            <View style={styles.rowDivider} />

            <Text style={styles.sectionLabel}>Stroke Width</Text>
            <View style={styles.widthRow}>
              {WIDTH_PRESETS.map(p => {
                const selected = effectiveWidth === p.value;
                return (
                  <Pressable
                    key={p.value}
                    testID={TEST_IDS.widthButton(p.value)}
                    onPress={() => handleWidthPress(p.value)}
                    style={({pressed}) => [
                      styles.widthBtn,
                      selected && styles.widthBtnSelected,
                      pressed && styles.widthBtnPressed,
                    ]}>
                    <View
                      style={[
                        styles.widthPreview,
                        {height: Math.max(2, Math.round(p.value / 100))},
                      ]}
                    />
                    <Text style={styles.widthLabel}>{p.mm.toFixed(2)}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.rowDivider} />

            <Text style={styles.sectionLabel}>Stroke Color</Text>
            <View style={styles.row}>
              {COLOR_PRESETS.map(c => {
                const selected = effectiveColor === c.value;
                return (
                  <Pressable
                    key={c.value}
                    testID={TEST_IDS.colorButton(c.value)}
                    onPress={() => handleColorPress(c.value)}
                    style={({pressed}) => [
                      styles.colorBtn,
                      selected && styles.colorBtnSelected,
                      pressed && styles.colorBtnPressed,
                    ]}>
                    <View style={[styles.colorSwatch, {backgroundColor: c.swatch}]} />
                    <Text style={styles.colorLabel}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.rowDivider} />

            <Text style={styles.sectionLabel}>Pen Type</Text>
            <View style={styles.row}>
              {PEN_TYPE_PRESETS.map(t => {
                const selected = effectivePenType === t.value;
                return (
                  <Pressable
                    key={t.value}
                    testID={TEST_IDS.penTypeButton(t.value)}
                    onPress={() => handlePenTypePress(t.value)}
                    style={({pressed}) => [
                      styles.penTypeBtn,
                      selected && styles.penTypeBtnSelected,
                      pressed && styles.penTypeBtnPressed,
                    ]}>
                    <View style={styles.penTypeStrokeWrapper}>
                      <View
                        style={[styles.penTypeStroke, penTypeStrokeStyle(t.value)]}
                      />
                    </View>
                    <Text style={styles.penTypeLabel}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.rowDivider} />

            <Pressable
              testID={TEST_IDS.delete}
              onPress={handleDelete}
              style={({pressed}) => [styles.deleteBtn, pressed && styles.deleteBtnPressed]}>
              <Text style={styles.deleteText}>Delete Shape</Text>
            </Pressable>
          </View>
        )}
      </Pressable>
    </Pressable>
  );
}

const PANEL_PADDING = 12;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    // Width is set to fit 9 width-preset buttons in one row without
    // cramping the tap target. 400 px × ~42 px/button is comfortable
    // stylus territory on Nomad (1404 px wide screen).
    width: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#000000',
    paddingBottom: PANEL_PADDING,
  },
  headerRow: {
    paddingHorizontal: PANEL_PADDING,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
  },
  closeBtn: {
    position: 'absolute',
    right: PANEL_PADDING,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnPressed: {
    backgroundColor: '#F0F0F0',
  },
  closeText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
  },
  divider: {
    height: 1,
    backgroundColor: '#CCCCCC',
  },
  centerRow: {
    padding: 20,
    alignItems: 'center',
  },
  helperText: {
    fontSize: 14,
    color: '#555555',
  },
  errorBanner: {
    marginHorizontal: PANEL_PADDING,
    marginTop: 8,
    backgroundColor: '#1A1A1A',
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: 13,
    textAlign: 'center',
  },
  body: {
    paddingHorizontal: PANEL_PADDING,
    paddingTop: 10,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  widthRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    // Tighter gap than `row` since 9 buttons need to fit; the larger gap
    // was tuned for 3–5 buttons and would push overflow off-screen.
    gap: 3,
  },
  rowDivider: {
    height: 1,
    backgroundColor: '#E5E5E5',
    marginVertical: 10,
  },
  widthBtn: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CCCCCC',
    gap: 4,
  },
  widthBtnSelected: {
    borderColor: '#000000',
    borderWidth: 2,
  },
  widthBtnPressed: {
    backgroundColor: '#F0F0F0',
  },
  widthPreview: {
    width: 20,
    backgroundColor: '#000000',
    borderRadius: 2,
  },
  widthLabel: {
    // Smaller font so the mm readout fits a ~40 px wide button.
    fontSize: 10,
    color: '#000000',
    fontWeight: '600',
  },
  penTypeBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CCCCCC',
    gap: 4,
  },
  penTypeBtnSelected: {
    borderColor: '#000000',
    borderWidth: 2,
  },
  penTypeBtnPressed: {
    backgroundColor: '#F0F0F0',
  },
  penTypeStrokeWrapper: {
    height: 12,
    width: '100%',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  penTypeStroke: {
    width: '100%',
    backgroundColor: '#000000',
  },
  penTypeLabel: {
    fontSize: 10,
    color: '#000000',
    fontWeight: '600',
  },
  colorBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CCCCCC',
    gap: 6,
  },
  colorBtnSelected: {
    borderColor: '#000000',
    borderWidth: 2,
  },
  colorBtnPressed: {
    backgroundColor: '#F0F0F0',
  },
  colorSwatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#000000',
  },
  colorLabel: {
    fontSize: 11,
    color: '#000000',
    fontWeight: '600',
  },
  deleteBtn: {
    backgroundColor: '#1A1A1A',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  deleteBtnPressed: {
    backgroundColor: '#333333',
  },
  deleteText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
