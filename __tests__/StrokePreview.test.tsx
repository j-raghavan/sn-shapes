/**
 * Tests for src/StrokePreview. Pure rendering component — no SDK/RN
 * native modules, just View/Image/Text, so we can exercise the pixel/mm/
 * color conversion logic directly and the rest of the panel stays
 * orthogonal.
 *
 * No sn-plugin-lib mock is needed here: StrokePreview imports helpers
 * (`formatPenWidthMm`, `penColorToSwatch`, `PEN_TYPE_PRESETS`) directly
 * from shapes.ts, which has no sn-plugin-lib dependency.
 *
 * Two render paths are covered:
 *   - iconSource provided → renders the PNG icon tinted with pen colour
 *     (the shipping path — ShapePalette always passes SHAPE_ICONS).
 *   - iconSource omitted → falls back to the geometry-type-dispatched
 *     View with StyleSheet borders (kept for loading / future shapes).
 */
import React from 'react';
import {create, act, ReactTestRenderer} from 'react-test-renderer';
import StrokePreview, {
  TEST_IDS,
  penWidthToPreviewPx,
  penWidthToSampleBarPx,
  penTypeOpacity,
  resolvePreviewGeometry,
} from '../src/StrokePreview';

function findByTestID(tree: ReactTestRenderer, testID: string) {
  return tree.root.findByProps({testID});
}

function renderPreview(props: Parameters<typeof StrokePreview>[0]): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<StrokePreview {...props} />);
  });
  return tree;
}

// Flatten an RN style array (or single style object) so individual style
// keys can be asserted regardless of how StrokePreview composes them.
function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign(
      {},
      ...style.filter(Boolean).map(s => flatten(s)),
    );
  }
  return (style as Record<string, unknown>) ?? {};
}

describe('penWidthToPreviewPx', () => {
  it('maps min penWidth to the floor', () => {
    expect(penWidthToPreviewPx(100)).toBe(3); // round(100/40) = 3, above MIN
    expect(penWidthToPreviewPx(0)).toBe(2);   // clamped to MIN
  });

  it('scales up proportionally through the preset range', () => {
    expect(penWidthToPreviewPx(400)).toBe(10);
    expect(penWidthToPreviewPx(900)).toBe(23);
  });

  it('clamps very thick pens to the preview ceiling', () => {
    // We don't know the exact on-device max, but an absurdly thick pen
    // shouldn't eat the whole preview area. Ceiling is MAX_STROKE_PX
    // (24 since the 2026-04-18 popup shrink — was 48).
    expect(penWidthToPreviewPx(10000)).toBe(24);
  });

  it('returns the floor for invalid input', () => {
    expect(penWidthToPreviewPx(undefined)).toBe(2);
    expect(penWidthToPreviewPx(NaN)).toBe(2);
    expect(penWidthToPreviewPx(-100)).toBe(2);
    expect(penWidthToPreviewPx(Infinity)).toBe(2);
  });
});

describe('penWidthToSampleBarPx', () => {
  // Sample-bar scale is deliberately tighter than penWidthToPreviewPx —
  // the bar is a proportion indicator next to a 38-px icon, not a
  // standalone shape renderer. Presets should map to 1/2/3/4/5 px so XS
  // and XL stay visibly distinct while the bar no longer reads as
  // disproportionately thicker than the on-device stroke.
  it('maps each WIDTH_PRESETS value to a distinct px step', () => {
    expect(penWidthToSampleBarPx(100)).toBe(1); // XS
    expect(penWidthToSampleBarPx(300)).toBe(2); // S
    expect(penWidthToSampleBarPx(500)).toBe(3); // M
    expect(penWidthToSampleBarPx(700)).toBe(4); // L
    expect(penWidthToSampleBarPx(900)).toBe(5); // XL
  });

  it('is strictly monotonic across the preset range', () => {
    const presetValues = [100, 300, 500, 700, 900];
    const heights = presetValues.map(penWidthToSampleBarPx);
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThan(heights[i - 1]);
    }
  });

  it('clamps absurdly thick pens to the sample-bar ceiling (6 px)', () => {
    // The bar is proportional to the icon (~38 px); no matter how thick
    // the pen is the bar stays under MAX_SAMPLE_BAR_PX so it doesn't
    // take over the column.
    expect(penWidthToSampleBarPx(10000)).toBe(6);
  });

  it('returns the floor for invalid input', () => {
    expect(penWidthToSampleBarPx(undefined)).toBe(1);
    expect(penWidthToSampleBarPx(NaN)).toBe(1);
    expect(penWidthToSampleBarPx(-100)).toBe(1);
    expect(penWidthToSampleBarPx(Infinity)).toBe(1);
    expect(penWidthToSampleBarPx(0)).toBe(1);
  });

  it('renders noticeably thinner than the fallback-line scale at every preset', () => {
    // Regression guard: the whole point of the rescale is that the bar
    // stays on-page-proportional. If someone re-unifies the two scales,
    // this assertion catches it.
    for (const v of [100, 300, 500, 700, 900]) {
      expect(penWidthToSampleBarPx(v)).toBeLessThan(penWidthToPreviewPx(v));
    }
  });
});

describe('penTypeOpacity', () => {
  it('returns 0.55 for marker (translucent ink)', () => {
    expect(penTypeOpacity(11)).toBe(0.55);
  });

  it('returns 1 for fineliner / pressure / calligraphy / unknown', () => {
    expect(penTypeOpacity(10)).toBe(1);
    expect(penTypeOpacity(1)).toBe(1);
    expect(penTypeOpacity(14)).toBe(1);
    expect(penTypeOpacity(undefined)).toBe(1);
    expect(penTypeOpacity(999)).toBe(1);
  });
});

describe('resolvePreviewGeometry', () => {
  it('returns outline mode for circle with equal width/height and half-size border radius', () => {
    const {mode, style} = resolvePreviewGeometry('GEO_circle', 10);
    expect(mode).toBe('outline');
    expect(style.width).toBe(style.height);
    // borderRadius = size/2 → the square renders as a circle.
    expect(style.borderRadius).toBe((style.width as number) / 2);
    expect(style.borderWidth).toBeGreaterThan(0);
  });

  it('returns outline mode for ellipse that is wider than tall', () => {
    const {mode, style} = resolvePreviewGeometry('GEO_ellipse', 10);
    expect(mode).toBe('outline');
    expect(style.width as number).toBeGreaterThan(style.height as number);
    expect(style.borderWidth).toBeGreaterThan(0);
  });

  it('returns outline mode for polygon with near-sharp corners', () => {
    const {mode, style} = resolvePreviewGeometry('GEO_polygon', 10);
    expect(mode).toBe('outline');
    // Polygon preview has small corner radius — distinguishes from
    // circle/ellipse which round fully.
    expect(style.borderRadius as number).toBeLessThan(10);
    expect(style.borderWidth).toBeGreaterThan(0);
  });

  it('returns line mode for straightLine (no border)', () => {
    const {mode, style} = resolvePreviewGeometry('straightLine', 10);
    expect(mode).toBe('line');
    expect(style.height).toBe(10);
    expect(style.borderWidth).toBeUndefined();
  });

  it('falls back to line mode for unknown / undefined shape', () => {
    expect(resolvePreviewGeometry(undefined, 10).mode).toBe('line');
    expect(resolvePreviewGeometry('GEO_mystery', 10).mode).toBe('line');
  });

  it('caps outline border thickness so a 0.90 mm pen does not solid-fill the shape', () => {
    // penWidthToPreviewPx(900) = 23 → outline cap should pull this down
    // to <= 7 so the circle still reads as an outline, not a disc.
    // Cap tightened 12 → 7 alongside the 2026-04-18 popup shrink so the
    // border stays proportional to the smaller 38-px preview icon.
    const {style} = resolvePreviewGeometry('GEO_circle', 23);
    expect(style.borderWidth as number).toBeLessThanOrEqual(7);
    expect(style.borderWidth as number).toBeGreaterThan(0);
  });

  it('keeps a minimum outline of 1px even for hairline strokes', () => {
    const {style} = resolvePreviewGeometry('GEO_circle', 1);
    expect(style.borderWidth as number).toBeGreaterThanOrEqual(1);
  });
});

describe('StrokePreview', () => {
  it('always renders a static "Preview" header', () => {
    // The header used to read the geometry display name ("Circle" /
    // "Ellipse" / "Polygon" / "Line") but that was redundant with the
    // grid selection AND actively confusing ("Polygon" for a pentagon
    // AND a parallelogram AND a rectangle). 2026-04-18 switched to a
    // static "Preview" label.
    for (const shapeType of ['GEO_circle', 'GEO_ellipse', 'GEO_polygon', 'straightLine', 'GEO_mystery', undefined]) {
      const tree = renderPreview({
        shapeType,
        penWidth: 400,
        penColor: 0x00,
        penType: 10,
      });
      expect(findByTestID(tree, TEST_IDS.shapeName).props.children).toBe('Preview');
    }
  });

  it('renders a circle with borderColor taken from penColor preset', () => {
    const tree = renderPreview({
      shapeType: 'GEO_circle',
      penWidth: 400,
      penColor: 0x00, // Black
      penType: 10,
    });
    const sample = findByTestID(tree, TEST_IDS.sample);
    const flat = flatten(sample.props.style);
    // Outline mode: color goes on the border, background is transparent.
    expect(flat.borderColor).toBe('#000000');
    expect(flat.backgroundColor).toBe('transparent');
    expect(flat.borderWidth).toBeGreaterThan(0);
  });

  it('renders a straightLine with backgroundColor taken from penColor preset', () => {
    const tree = renderPreview({
      shapeType: 'straightLine',
      penWidth: 400,
      penColor: 0x00,
      penType: 10,
    });
    const sample = findByTestID(tree, TEST_IDS.sample);
    const flat = flatten(sample.props.style);
    // Line mode: color fills the bar itself.
    expect(flat.backgroundColor).toBe('#000000');
    expect(flat.borderWidth).toBeUndefined();
  });

  it('renders straightLine with height scaled from penWidth', () => {
    const tree = renderPreview({
      shapeType: 'straightLine',
      penWidth: 900,
      penColor: 0x00,
      penType: 10,
    });
    const sample = findByTestID(tree, TEST_IDS.sample);
    const flat = flatten(sample.props.style);
    expect(flat.height).toBe(23);
  });

  it('renders circle borderWidth scaled (and capped) from penWidth', () => {
    // penWidth 900 → strokePx 23 → outlinePx capped at 7 (2026-04-18
    // popup shrink pulled MAX_OUTLINE_PX down from 12 → 7).
    const tree = renderPreview({
      shapeType: 'GEO_circle',
      penWidth: 900,
      penColor: 0x00,
      penType: 10,
    });
    const sample = findByTestID(tree, TEST_IDS.sample);
    const flat = flatten(sample.props.style);
    expect(flat.borderWidth as number).toBeGreaterThan(0);
    expect(flat.borderWidth as number).toBeLessThanOrEqual(7);
  });

  it('renders ellipse wider than tall', () => {
    const tree = renderPreview({
      shapeType: 'GEO_ellipse',
      penWidth: 400,
      penColor: 0x00,
      penType: 10,
    });
    const sample = findByTestID(tree, TEST_IDS.sample);
    const flat = flatten(sample.props.style);
    expect(flat.width as number).toBeGreaterThan(flat.height as number);
    expect(flat.borderColor).toBe('#000000');
  });

  it('renders polygon with outlined border and minimal radius', () => {
    const tree = renderPreview({
      shapeType: 'GEO_polygon',
      penWidth: 400,
      penColor: 0x00,
      penType: 10,
    });
    const sample = findByTestID(tree, TEST_IDS.sample);
    const flat = flatten(sample.props.style);
    expect(flat.borderColor).toBe('#000000');
    expect(flat.borderRadius as number).toBeLessThan(10);
  });

  it('applies marker opacity (0.55) to the sample', () => {
    const tree = renderPreview({
      shapeType: 'GEO_circle',
      penWidth: 400,
      penColor: 0x00,
      penType: 11, // Marker
    });
    const sample = findByTestID(tree, TEST_IDS.sample);
    const flat = flatten(sample.props.style);
    expect(flat.opacity).toBe(0.55);
  });

  it('leaves fineliner / pressure / calligraphy at full opacity', () => {
    for (const penType of [10, 1, 14]) {
      const tree = renderPreview({
        shapeType: 'GEO_circle',
        penWidth: 400,
        penColor: 0x00,
        penType,
      });
      const sample = findByTestID(tree, TEST_IDS.sample);
      const flat = flatten(sample.props.style);
      expect(flat.opacity).toBe(1);
    }
  });

  it('renders meta row with pen type label and mm value', () => {
    const tree = renderPreview({
      shapeType: 'GEO_polygon',
      penWidth: 400,
      penColor: 0x00,
      penType: 11, // Marker
    });
    expect(findByTestID(tree, TEST_IDS.meta).props.children).toBe(
      'Marker · 0.40 mm',
    );
  });

  it('renders placeholders when geometry fields are undefined', () => {
    const tree = renderPreview({
      shapeType: undefined,
      penWidth: undefined,
      penColor: undefined,
      penType: undefined,
    });
    expect(findByTestID(tree, TEST_IDS.shapeName).props.children).toBe('Preview');
    expect(findByTestID(tree, TEST_IDS.meta).props.children).toBe('— · —');
  });

  // ---------------------------------------------------------------------------
  // Dynamic stroke-width sample bar
  //
  // The PNG icon tinted with tintColor communicates shape + colour but not
  // thickness — the icon bitmap has fixed line weight. The sample bar lives
  // below the icon and grows with penWidth, so the user sees immediate
  // feedback when they tap a Stroke Width preset. This was the fix for the
  // 2026-04-18 "preview doesn't update when stroke width changes" bug.
  // ---------------------------------------------------------------------------
  describe('strokeSample (width-feedback bar)', () => {
    it('renders a width-sample bar alongside the icon', () => {
      const tree = renderPreview({
        shapeType: 'GEO_polygon',
        penWidth: 400,
        penColor: 0x00,
        penType: 10,
        iconSource: 77,
      });
      // Always rendered, regardless of iconSource presence.
      expect(findByTestID(tree, TEST_IDS.strokeSample)).toBeTruthy();
    });

    it('renders a width-sample bar in fallback mode too (no iconSource)', () => {
      const tree = renderPreview({
        shapeType: 'GEO_polygon',
        penWidth: 400,
        penColor: 0x00,
        penType: 10,
      });
      expect(findByTestID(tree, TEST_IDS.strokeSample)).toBeTruthy();
    });

    it('scales height with penWidth', () => {
      const thin = renderPreview({
        shapeType: 'GEO_polygon',
        penWidth: 100,
        penColor: 0x00,
        penType: 10,
        iconSource: 77,
      });
      const thick = renderPreview({
        shapeType: 'GEO_polygon',
        penWidth: 900,
        penColor: 0x00,
        penType: 10,
        iconSource: 77,
      });
      const thinStyle = flatten(findByTestID(thin, TEST_IDS.strokeSample).props.style);
      const thickStyle = flatten(findByTestID(thick, TEST_IDS.strokeSample).props.style);
      // Sample bar uses penWidthToSampleBarPx (on-page-proportional)
      // rather than penWidthToPreviewPx (fallback-line-renderer scale):
      // 100 → 1 px, 900 → 5 px under the new 1/200 conversion.
      expect(thinStyle.height as number).toBe(1);
      expect(thickStyle.height as number).toBe(5);
      expect(thickStyle.height as number).toBeGreaterThan(thinStyle.height as number);
    });

    it('uses the resolved pen colour as backgroundColor', () => {
      const tree = renderPreview({
        shapeType: 'GEO_circle',
        penWidth: 400,
        penColor: 0x9D, // Dark+
        penType: 10,
        iconSource: 77,
      });
      const flat = flatten(findByTestID(tree, TEST_IDS.strokeSample).props.style);
      // penColorToSwatch(0x9D) → '#5A5A5A'
      expect(flat.backgroundColor).toBe('#5A5A5A');
    });

    it('applies marker opacity to the sample bar', () => {
      const tree = renderPreview({
        shapeType: 'GEO_circle',
        penWidth: 400,
        penColor: 0x00,
        penType: 11, // Marker
        iconSource: 77,
      });
      const flat = flatten(findByTestID(tree, TEST_IDS.strokeSample).props.style);
      expect(flat.opacity).toBe(0.55);
    });
  });

  // ---------------------------------------------------------------------------
  // iconSource rendering path (shipping path — ShapePalette always passes it)
  // ---------------------------------------------------------------------------
  describe('iconSource rendering', () => {
    // Numeric IDs simulate the result of `require('./asset.png')` that React
    // Native's asset registry produces; Image accepts them as `source`.
    const FAKE_ICON = 99;

    it('renders a tinted Image when iconSource is provided', () => {
      const tree = renderPreview({
        shapeType: 'GEO_polygon',
        penWidth: 400,
        penColor: 0x00,
        penType: 10,
        iconSource: FAKE_ICON,
      });
      const icon = findByTestID(tree, TEST_IDS.icon);
      expect(icon.props.source).toBe(FAKE_ICON);
      const flat = flatten(icon.props.style);
      // tintColor recolours the black PNG to the current pen colour.
      expect(flat.tintColor).toBe('#000000');
      expect(flat.opacity).toBe(1);
    });

    it('does NOT render the geometry fallback sample when iconSource is provided', () => {
      const tree = renderPreview({
        shapeType: 'GEO_polygon',
        penWidth: 400,
        penColor: 0x00,
        penType: 10,
        iconSource: FAKE_ICON,
      });
      // testID 'stroke-preview-sample' is the fallback View. It must be
      // absent when the icon path renders, otherwise both show up.
      expect(() => findByTestID(tree, TEST_IDS.sample)).toThrow();
    });

    it('renders the geometry fallback when iconSource is omitted', () => {
      const tree = renderPreview({
        shapeType: 'GEO_polygon',
        penWidth: 400,
        penColor: 0x00,
        penType: 10,
      });
      expect(findByTestID(tree, TEST_IDS.sample)).toBeTruthy();
      expect(() => findByTestID(tree, TEST_IDS.icon)).toThrow();
    });

    it('applies marker opacity (0.55) to the tinted icon', () => {
      const tree = renderPreview({
        shapeType: 'GEO_polygon',
        penWidth: 400,
        penColor: 0x00,
        penType: 11, // Marker
        iconSource: FAKE_ICON,
      });
      const icon = findByTestID(tree, TEST_IDS.icon);
      const flat = flatten(icon.props.style);
      expect(flat.opacity).toBe(0.55);
    });

    it('tints the icon with the selected pen colour', () => {
      const tree = renderPreview({
        shapeType: 'GEO_circle',
        penWidth: 400,
        penColor: 0xC9,
        penType: 10,
        iconSource: FAKE_ICON,
      });
      const icon = findByTestID(tree, TEST_IDS.icon);
      const flat = flatten(icon.props.style);
      // penColor 0xC9 resolves through penColorToSwatch to a defined
      // string — we only assert it's non-black so the tint path really
      // flows the color through.
      expect(typeof flat.tintColor).toBe('string');
      expect(flat.tintColor).not.toBe('#000000');
    });
  });
});
