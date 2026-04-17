/**
 * ShapeOptionsPanel — Compact inline popover for the "Shape Options"
 * contextual lasso-toolbar button (id=200, registered in index.js).
 *
 * Flow:
 *   1. Opens when the user lassos a shape and taps Shape Options in the
 *      firmware's overflow menu. The plugin UI starts, App.tsx routes to
 *      this component (see pluginRouter).
 *   2. On mount, calls PluginCommAPI.getLassoGeometries() to read the
 *      current geometry (firmware keeps the lasso selection active while
 *      the plugin runs, confirmed via logcat line 28760 sendMenuItemEvent).
 *   3. Renders three action groups — Stroke Width, Stroke Color, Delete.
 *      Picking width or color calls modifyLassoGeometry with the full
 *      geometry (GeometrySchema requires penColor/penType/penWidth/type).
 *      Tapping Delete calls deleteLassoElements().
 *   4. After any action completes (or fails with no retry value), closes
 *      the plugin view via PluginManager.closePluginView().
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {PluginCommAPI, PluginManager} from 'sn-plugin-lib';

export const TEST_IDS = {
  overlay: 'shape-options-overlay',
  widthButton: (w: number) => `shape-options-width-${w}`,
  colorButton: (c: number) => `shape-options-color-${c}`,
  delete: 'shape-options-delete',
  error: 'shape-options-error',
  loading: 'shape-options-loading',
  empty: 'shape-options-empty',
} as const;

// Pen-width presets. GeometrySchema.penWidth requires min: 100. These five
// values mirror the sidebar pen ticks and keep the default (400) in the
// middle so the most common selection needs the smallest thumb travel.
export const WIDTH_PRESETS: ReadonlyArray<{value: number; label: string}> = [
  {value: 200, label: 'XS'},
  {value: 300, label: 'S'},
  {value: 400, label: 'M'},
  {value: 600, label: 'L'},
  {value: 900, label: 'XL'},
];

// Pen-color presets. The Supernote firmware enforces an allow-list of
// penColor values on the native side (see
// node_modules/sn-plugin-lib/android/.../constant/Constant.java → PEN_COLORS
// and the docstring on Element.ts line 734:
//   `0x00=black, 0x9D=dark gray, 0xC9=light gray, 0xFE=white`).
// Arbitrary ints (e.g. 0x80, 0xC8) are rejected by the native bridge with
// a "Invalid color value. Cannot call the API" toast — so we stick to the
// documented palette. White is intentionally omitted since a white stroke
// on white paper is invisible and would confuse users.
export const COLOR_PRESETS: ReadonlyArray<{value: number; label: string; swatch: string}> = [
  {value: 0x00, label: 'Black', swatch: '#000000'},
  {value: 0x9D, label: 'Dark', swatch: '#9D9D9D'},
  {value: 0xC9, label: 'Light', swatch: '#C9C9C9'},
];

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

export default function ShapeOptionsPanel() {
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    readFirstLassoGeometry().then(g => {
      setGeometry(g);
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

  const close = useCallback(() => {
    PluginManager.closePluginView();
  }, []);

  const applyPatch = useCallback(
    async (patch: Partial<Pick<Geometry, 'penWidth' | 'penColor'>>) => {
      if (busyRef.current || !geometry) {return;}
      busyRef.current = true;
      setError(null);
      try {
        const merged: Geometry = {...geometry, ...patch};
        const res = await PluginCommAPI.modifyLassoGeometry(merged);
        const success =
          res != null && typeof res === 'object' && (res as any).success === true;
        if (!success) {
          const msg = (res as any)?.error?.message ?? 'Modify failed';
          showError(msg);
          return;
        }
        close();
      } catch (e) {
        showError(e instanceof Error ? e.message : 'Modify failed');
      } finally {
        busyRef.current = false;
      }
    },
    [geometry, close, showError],
  );

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
      close();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      busyRef.current = false;
    }
  }, [close, showError]);

  const handleOverlayPress = useCallback(() => {
    if (!busyRef.current) {close();}
  }, [close]);

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
            <Text style={styles.sectionLabel}>Stroke Width</Text>
            <View style={styles.row}>
              {WIDTH_PRESETS.map(p => {
                const selected = geometry.penWidth === p.value;
                return (
                  <Pressable
                    key={p.value}
                    testID={TEST_IDS.widthButton(p.value)}
                    onPress={() => applyPatch({penWidth: p.value})}
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
                    <Text style={styles.widthLabel}>{p.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.rowDivider} />

            <Text style={styles.sectionLabel}>Stroke Color</Text>
            <View style={styles.row}>
              {COLOR_PRESETS.map(c => {
                const selected = geometry.penColor === c.value;
                return (
                  <Pressable
                    key={c.value}
                    testID={TEST_IDS.colorButton(c.value)}
                    onPress={() => applyPatch({penColor: c.value})}
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
    width: 320,
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
  rowDivider: {
    height: 1,
    backgroundColor: '#E5E5E5',
    marginVertical: 10,
  },
  widthBtn: {
    flex: 1,
    paddingVertical: 8,
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
    width: 24,
    backgroundColor: '#000000',
    borderRadius: 2,
  },
  widthLabel: {
    fontSize: 11,
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
