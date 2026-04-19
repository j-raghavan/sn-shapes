/**
 * StrokePreview — the Preview region of the Shapes popup.
 *
 * Renders a scale-model of the selected shape with the current (possibly
 * pending) pen style applied, so the user can see what the shape will
 * look like on the page BEFORE committing via the deferred-apply flow.
 *
 * Rendering strategy:
 *   1. Preferred — when `iconSource` is provided, render the shape's PNG
 *      icon tinted with the current pen colour. This gives a pixel-perfect
 *      preview of the *actual* shape the user picked (pentagon looks like
 *      a pentagon, parallelogram looks like a parallelogram) rather than a
 *      generic polygon/rectangle stand-in. Tuned for e-ink: the icons are
 *      authored at ~48 px native, so we render them at PREVIEW_ICON_SIZE
 *      px to stay within authoring resolution.
 *   2. Fallback — when no icon is provided (e.g. during loading, tests,
 *      or future geometry types without an icon), fall back to a geometry-
 *      type-dispatched View with StyleSheet borders. This is the original
 *      pure-View rendering kept around so the component still produces
 *      *something* sensible without an icon.
 *
 * The header label is a static "Preview" string. It used to read the
 * geometry display name ("Polygon" / "Circle" / "Ellipse" / "Line") but
 * that was redundant — the grid selection and the rendered icon already
 * tell the user which shape they're looking at, and "Polygon" for
 * everything from pentagon to parallelogram was actively unhelpful.
 *
 * Pen-type is primarily communicated in the meta row ("Fineliner · 0.40
 * mm") because the visual differences (pressure taper, calligraphy angle)
 * can't be reproduced faithfully in pure View styles or via simple PNG
 * tints. The one effect we DO apply is Marker opacity — it reads as
 * translucent both in preview and on-device.
 */
import React from 'react';
import {View, Text, StyleSheet, ViewStyle, Image, ImageSourcePropType} from 'react-native';
import {
  formatPenWidthMm,
  penColorToSwatch,
  PEN_TYPE_PRESETS,
} from './ShapeOptionsPanel';

export const TEST_IDS = {
  container: 'stroke-preview',
  sample: 'stroke-preview-sample',
  // Back-compat alias — the sample node was historically named "stroke"
  // when the preview was always a horizontal line. Keeping the same
  // string under both keys avoids churn for any downstream test refs.
  stroke: 'stroke-preview-sample',
  shapeName: 'stroke-preview-shape-name',
  meta: 'stroke-preview-meta',
  icon: 'stroke-preview-icon',
  // Dedicated width-sample bar rendered below the shape icon. The PNG
  // icon can't be thickened dynamically (tintColor recolours but doesn't
  // grow strokes), so we render a parallel sample whose height scales
  // with the current penWidth. This is what users watch when they tap a
  // Stroke Width preset to verify "yes, that got thicker".
  strokeSample: 'stroke-preview-width-sample',
} as const;

type Props = {
  shapeType: string | undefined;
  penWidth: number | undefined;
  penColor: number | undefined;
  penType: number | undefined;
  /**
   * PNG icon source for the selected shape. When provided, the preview
   * renders this icon tinted with the resolved pen colour. SHAPE_ICONS
   * in ShapePalette is the canonical source.
   */
  iconSource?: ImageSourcePropType;
};

// Empirical conversion used only for the preview. penWidth is in
// micrometres (penWidth=400 → 0.40 mm on-device). For display we want a
// range that reads distinctly from "hairline" at 0.10 mm to "brush" at
// 0.90 mm without eating the whole preview area. 1 px per 40 μm lands us
// at 2.5 px … 22.5 px across the preset range. The ratio is preserved
// across the 2026-04-18 popup shrink — only MAX_STROKE_PX came down
// (48 → 24) so absurdly thick pens can't outgrow the scaled preview.
const STROKE_PX_PER_PENWIDTH = 1 / 40;
const MIN_STROKE_PX = 2;
const MAX_STROKE_PX = 24;

// Preview frame + shape sizing. Tuned so the widest fallback shape
// (ellipse at SHAPE_SIZE * ELLIPSE_ASPECT) fits inside a compact right
// column and the tallest shape fits the frame with room to centre. The
// PNG preview uses PREVIEW_ICON_SIZE — at 38 px we're well below the
// authoring resolution (~48 px native), which RN downscales cleanly on
// e-ink without the aliasing that happens if we render *above* native.
// All dimensions were scaled ~0.6 for the 2026-04-18 popup shrink.
const FRAME_HEIGHT = 66;
const SHAPE_SIZE = 38;
const ELLIPSE_ASPECT = 1.7;
const POLYGON_ASPECT = 1.3;
const PREVIEW_ICON_SIZE = 38;

// Outline-mode border thickness is half the line-mode stroke px, capped
// at MAX_OUTLINE_PX. Without the cap, a 0.90 mm pen would border-fill a
// 38×38 circle into a near-solid disc. The half-factor mimics the on-
// device impression that a 0.90 mm circle outline is less visually heavy
// than a 0.90 mm filled bar of the same height.
const MAX_OUTLINE_PX = 7;

export function penWidthToPreviewPx(penWidth: number | undefined): number {
  if (typeof penWidth !== 'number' || !Number.isFinite(penWidth) || penWidth <= 0) {
    return MIN_STROKE_PX;
  }
  const raw = penWidth * STROKE_PX_PER_PENWIDTH;
  const rounded = Math.round(raw);
  return Math.max(MIN_STROKE_PX, Math.min(MAX_STROKE_PX, rounded));
}

function penTypeLabel(penType: number | undefined): string {
  const preset = PEN_TYPE_PRESETS.find(p => p.value === penType);
  return preset?.label ?? '—';
}

/**
 * Marker is the only pen type whose on-device appearance can be
 * approximated with a single View style (translucent ink). Everything
 * else stays opaque — pressure taper and calligraphy angle need SVG
 * paths or per-pixel alpha we can't fake without misrepresenting the
 * actual firmware output.
 */
export function penTypeOpacity(penType: number | undefined): number {
  return penType === 11 ? 0.55 : 1;
}

export type PreviewMode = 'outline' | 'line';

/**
 * Resolve the fallback geometry-specific ViewStyle for the preview
 * sample. Pure — pulled out of the render body so we can unit-test the
 * shape-dispatch decision without rendering. Only consulted when no
 * `iconSource` prop is supplied.
 */
export function resolvePreviewGeometry(
  shapeType: string | undefined,
  strokePx: number,
): {mode: PreviewMode; style: ViewStyle} {
  const outlinePx = Math.max(1, Math.min(MAX_OUTLINE_PX, Math.round(strokePx / 2)));
  switch (shapeType) {
    case 'GEO_circle':
      return {
        mode: 'outline',
        style: {
          width: SHAPE_SIZE,
          height: SHAPE_SIZE,
          borderRadius: SHAPE_SIZE / 2,
          borderWidth: outlinePx,
        },
      };
    case 'GEO_ellipse':
      return {
        mode: 'outline',
        style: {
          width: SHAPE_SIZE * ELLIPSE_ASPECT,
          height: SHAPE_SIZE,
          // borderRadius > height/2 renders as a stadium in RN, which at
          // this scale reads as ellipse-like. Good enough without SVG.
          borderRadius: SHAPE_SIZE / 2,
          borderWidth: outlinePx,
        },
      };
    case 'GEO_polygon':
      return {
        mode: 'outline',
        style: {
          width: SHAPE_SIZE * POLYGON_ASPECT,
          height: SHAPE_SIZE,
          // 2 px keeps corners crisp on e-ink while avoiding a razor-
          // sharp aliased look at low DPI.
          borderRadius: 2,
          borderWidth: outlinePx,
        },
      };
    case 'straightLine':
      return {
        mode: 'line',
        style: {
          width: '80%',
          height: strokePx,
          borderRadius: Math.min(strokePx / 2, 12),
        },
      };
    default:
      // Unknown / undefined shape → fall back to a horizontal bar. Used
      // during loading (before geometry reads) and for any future GEO_*
      // type we haven't special-cased yet.
      return {
        mode: 'line',
        style: {
          width: '80%',
          height: strokePx,
          borderRadius: Math.min(strokePx / 2, 12),
        },
      };
  }
}

export default function StrokePreview({
  shapeType,
  penWidth,
  penColor,
  penType,
  iconSource,
}: Props) {
  const strokePx = penWidthToPreviewPx(penWidth);
  const color = penColorToSwatch(penColor);
  const meta = `${penTypeLabel(penType)} · ${formatPenWidthMm(penWidth)}`;
  const opacity = penTypeOpacity(penType);

  // Prefer the PNG icon when provided — it's the actual shape the user
  // selected (pentagon, parallelogram, etc.) rather than a generic
  // polygon stand-in. tintColor recolours the icon with the pen colour;
  // opacity covers marker translucency.
  const showIcon = iconSource !== undefined;
  const {mode, style: shapeStyle} = resolvePreviewGeometry(shapeType, strokePx);

  return (
    <View testID={TEST_IDS.container} style={styles.container}>
      <Text testID={TEST_IDS.shapeName} style={styles.shapeName}>
        Preview
      </Text>
      <View style={styles.frame}>
        {showIcon ? (
          <Image
            testID={TEST_IDS.icon}
            source={iconSource}
            resizeMode="contain"
            style={[
              styles.icon,
              {tintColor: color, opacity},
            ]}
          />
        ) : (
          <View
            testID={TEST_IDS.sample}
            style={[
              shapeStyle,
              mode === 'outline' ? styles.outlineBase : null,
              mode === 'outline'
                ? {borderColor: color, opacity}
                : {backgroundColor: color, opacity},
            ]}
          />
        )}
      </View>
      {/*
        Width-sample bar. Rendered unconditionally (alongside the icon
        path) so the user sees stroke-width changes immediately: the PNG
        icon can be tinted to the right colour but its line thickness is
        baked into the bitmap, so changing the Stroke Width preset
        wouldn't give any visual feedback without this bar. Height =
        penWidthToPreviewPx(penWidth), colour = resolved pen colour,
        opacity = penTypeOpacity (marker shows as 0.55).
      */}
      <View style={styles.strokeSampleWrapper}>
        <View
          testID={TEST_IDS.strokeSample}
          style={[
            styles.strokeSampleBar,
            {
              height: strokePx,
              backgroundColor: color,
              opacity,
              borderRadius: Math.min(strokePx / 2, 12),
            },
          ]}
        />
      </View>
      <Text testID={TEST_IDS.meta} style={styles.meta}>
        {meta}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 8,
    alignItems: 'stretch',
  },
  shapeName: {
    fontSize: 10,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 5,
    textAlign: 'center',
  },
  frame: {
    // Fixed height keeps the panel from jumping as shape type or pen
    // width changes. Must fit the tallest shape (SHAPE_SIZE) plus top
    // and bottom borderWidth.
    height: FRAME_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  icon: {
    width: PREVIEW_ICON_SIZE,
    height: PREVIEW_ICON_SIZE,
  },
  outlineBase: {
    // Hoisted out of the render callback so eslint's no-inline-styles
    // rule doesn't fire on this static value.
    backgroundColor: 'transparent',
  },
  strokeSampleWrapper: {
    // Narrow band below the icon that hosts the width-sample bar. Kept
    // small (fixed max height) so it doesn't steal vertical space from
    // the icon, but wide enough for a visibly thickening bar at 0.90 mm
    // (≈18 px under the 1/50 conversion). Centre-aligned to match the
    // icon's horizontal centre.
    height: MAX_STROKE_PX + 4,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
    marginTop: 3,
  },
  strokeSampleBar: {
    // Width is a generous % of the preview column so the bar reads as
    // "how thick is this stroke" at a glance. Height is set inline at
    // render time to the pixel-converted penWidth.
    width: '80%',
  },
  meta: {
    marginTop: 4,
    fontSize: 10,
    color: '#555555',
    textAlign: 'center',
  },
});
