import React, {useCallback, useEffect, useRef, useState} from 'react';
import {View, Image, Text, Pressable, StyleSheet, ImageSourcePropType} from 'react-native';
import {PluginCommAPI, PluginManager, PluginFileAPI} from 'sn-plugin-lib';
import {SHAPES, Shape, ShapeId, PEN_DEFAULTS} from './shapes';

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------
const COLS = 4;

// Panel width matches Supernote's native system popup width (~670px on Manta
// 1920px wide, proportionally ~490px on Nomad 1404px wide).
const PANEL_WIDTH_RATIO = 0.20;

// Fixed spacing — these don't need to scale, they just need to look right.
// Cell size is derived so the grid always fills the panel edge-to-edge.
const PANEL_PADDING = 10;
const CELL_GAP = 6;

function computeLayout(pageWidth: number) {
  const panelWidth = Math.round(pageWidth * PANEL_WIDTH_RATIO);
  // Cell fills whatever width remains after padding and gaps are accounted for.
  const cell = Math.floor((panelWidth - PANEL_PADDING * 2 - CELL_GAP * (COLS - 1)) / COLS);
  // Thumbnail is 75% of cell — comfortable margin inside each cell.
  const thumbnail = Math.round(cell * 0.75);
  return { cell, gap: CELL_GAP, padding: PANEL_PADDING, thumbnail, panelWidth };
}

export const DEFAULT_PAGE_WIDTH = 1404;
export const DEFAULT_PAGE_HEIGHT = 1872;
export const SHAPE_SIZE_RATIO = 0.12;

export const TEST_IDS = {
  overlay: 'shapes-overlay',
  cell: (id: ShapeId) => `shape-cell-${id}`,
  error: 'shapes-error',
} as const;

export const SHAPE_ICONS: Record<ShapeId, ImageSourcePropType> = {
  rectangle: require('../assets/shapes/shape_square.png'),
  circle: require('../assets/shapes/shape_circle.png'),
  roundedRect: require('../assets/shapes/shape_roundedRect.png'),
  ellipse: require('../assets/shapes/shape_ellipse.png'),
  triangle: require('../assets/shapes/shape_triangle.png'),
  diamond: require('../assets/shapes/shape_diamond.png'),
  pentagon: require('../assets/shapes/shape_pentagon.png'),
  hexagon: require('../assets/shapes/shape_hexagon.png'),
  heptagon: require('../assets/shapes/shape_heptagon.png'),
  octagon: require('../assets/shapes/shape_octagon.png'),
  line: require('../assets/shapes/shape_line.png'),
  parallelogram: require('../assets/shapes/shape_parallelogram.png'),
};

async function resolvePageSize(): Promise<{ width: number; height: number }> {
  try {
    const pathRes = await PluginCommAPI.getCurrentFilePath();
    const pageRes = await PluginCommAPI.getCurrentPageNum();
    if (pathRes?.success && pageRes?.success) {
      const sizeRes = await PluginFileAPI.getPageSize(pathRes.result, pageRes.result);
      if (sizeRes?.success && sizeRes.result) {
        return sizeRes.result;
      }
    }
  } catch {
    // Fall through to defaults
  }
  return { width: DEFAULT_PAGE_WIDTH, height: DEFAULT_PAGE_HEIGHT };
}

async function insertShape(shape: Shape, pageWidth: number, pageHeight: number): Promise<void> {
  const center = { x: pageWidth / 2, y: pageHeight / 2 };

  const params = Object.fromEntries(
    shape.parameters.map(p => [p.id, p.defaultValue])
  );

  const geometry = shape.build(center, params, PEN_DEFAULTS);
  
  const res = await PluginCommAPI.insertGeometry(geometry);
  if (!res?.success) {
    console.error('insertGeometry failed:', JSON.stringify(res));
    throw new Error(res?.error?.message ?? 'insertGeometry failed');
  }
}

const ERROR_DISPLAY_MS = 2000;

const SidebarNode = () => (
  <View style={styles.nodeContainer}>
  <View style={styles.nodeDot} />
  <View style={styles.nodeLine} />
  </View>
);

export default function ShapePalette() {
  const insertingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pageWidth, setPageWidth] = useState(DEFAULT_PAGE_WIDTH);
  const [pageHeight, setPageHeight] = useState(DEFAULT_PAGE_HEIGHT);

  useEffect(() => {
    resolvePageSize().then(({ width, height }) => {
      setPageWidth(width);
      setPageHeight(height);
    });
    return () => {
      if (errorTimerRef.current) {clearTimeout(errorTimerRef.current);}
    };
  }, []);

const layout = computeLayout(pageWidth);

  const handleShapeTap = useCallback(async (shape: Shape) => {
    if (insertingRef.current) {return;}
    insertingRef.current = true;
    setError(null);
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    try {
      await insertShape(shape, pageWidth, pageHeight);
      PluginManager.closePluginView();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Insert failed';
      setError(message);
      errorTimerRef.current = setTimeout(() => setError(null), ERROR_DISPLAY_MS);
    } finally {
      insertingRef.current = false;
    }
  }, [pageWidth, pageHeight]);

  const handleOverlayPress = useCallback(() => {
    if (!insertingRef.current) {
      PluginManager.closePluginView();
    }
  }, []);

  const rows: Shape[][] = [];
  for (let i = 0; i < SHAPES.length; i += COLS) {
    rows.push(SHAPES.slice(i, i + COLS));
  }

  return (
    <Pressable testID={TEST_IDS.overlay} style={styles.container} onPress={handleOverlayPress}>
      <Pressable style={[styles.panel, { width: layout.panelWidth }]} onPress={e => e.stopPropagation()}>
        <SidebarNode />
        <View style={styles.panelHeaderRow}>
          <Text style={styles.panelTitle}>Shapes</Text>
          <Pressable
            onPress={() => setShowTooltip(v => !v)}
            style={({ pressed }) => [styles.headerIconBtn, pressed && styles.headerIconBtnPressed]}>
            <Text style={styles.headerIconText}>{'?'}</Text>
          </Pressable>
        </View>
        <View style={styles.divider} />
        {error && (
          <View testID={TEST_IDS.error} style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        <View style={styles.gridWrapper}>
          <View style={[styles.gridContainer, { padding: layout.padding }]}>
            {rows.map((row, rowIdx) => (
              <View key={rowIdx}>
                {rowIdx > 0 && <View style={styles.rowDivider} />}
                <View style={[styles.row, { gap: layout.gap }]}>
                  {row.map(shape => (
                    <Pressable
                      testID={TEST_IDS.cell(shape.id)}
                      key={shape.id}
                      style={[styles.cell, { width: layout.cell, height: layout.cell }]}
                      onPress={() => handleShapeTap(shape)}>
                      <Image
                        source={SHAPE_ICONS[shape.id]}
                        style={[styles.thumbnail, { width: layout.thumbnail, height: layout.thumbnail }]}
                      />
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </View>
          {showTooltip && (
            <View style={styles.tooltipWrapper}>
              {/* The black outline for the triangle */}
              <View style={styles.tooltipCaretBorder} />
              {/* The white inside of the triangle */}
              <View style={styles.tooltipCaretFill} />

              <View style={styles.tooltipBubble}>
                <Text style={styles.tooltipText}>
                  Single tap to draw instantly.{'\n'}
                  Made with ❤️ for those who write.
                </Text>
                <Pressable onPress={() => setShowTooltip(false)} hitSlop={10} style={styles.tooltipClose}>
                  <Text style={styles.tooltipCloseText}>✕</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'transparent',
  },
  panel: {
    marginLeft: 90,
    top: '50%',
    transform: [{ translateY: -59 }],
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#000000',
    overflow: 'visible',
  },
  panelHeaderRow: {
    paddingHorizontal: PANEL_PADDING,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  panelTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#000000',
  },
  headerIconBtn: {
    position: 'absolute',
    right: PANEL_PADDING,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconBtnPressed: {
    backgroundColor: '#F0F0F0',
  },
  headerIconText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#000000',
  },
  tooltipWrapper: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 250,
    zIndex: 999,
  },
  tooltipBubble: {
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#000000',
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  tooltipText: {
    flex: 1,
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
    lineHeight: 18,
    marginRight: 8,
  },
  tooltipClose: {
    padding: 2,
  },
  tooltipCloseText: {
    fontSize: 14,
    color: '#000000',
    fontWeight: 'bold',
  },
  tooltipCaretBorder: {
    position: 'absolute',
    top: -10, // Pulls the triangle up outside the bubble
    right: 10,
    width: 0,
    height: 0,
    borderStyle: 'solid',
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#000000', // Draws the black outline
  },
  tooltipCaretFill: {
    position: 'absolute',
    top: -8,
    right: 11, // Shifted by 1px to center perfectly inside the border caret
    width: 0,
    height: 0,
    borderStyle: 'solid',
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#FFFFFF', // Draws the white interior
    zIndex: 1, // Guarantees this sits on top of the black caret
  },
  divider: {
    height: 1,
    backgroundColor: '#CCCCCC',
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: '#CCCCCC',
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
    height: 0,
    marginVertical: CELL_GAP,
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
  gridWrapper: {
    position: 'relative',
  },
  gridContainer: {},
  row: {
    flexDirection: 'row',
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnail: {
    resizeMode: 'contain',
  },
  nodeContainer: {
    position: 'absolute',
    left: -22, // Sits in the gap between toolbar and panel
    top: 24,   // Centers vertically with the "Shapes" title
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },
  nodeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#000000', // Pure black for e-ink
  },
  nodeLine: {
    width: 12, // Short bridge from dot to panel border
    height: 1.5,
    backgroundColor: '#000000',
  },
});
