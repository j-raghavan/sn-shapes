/**
 * PlacementOverlay — the full-screen responder behind the Shapes panel.
 *
 * Owns the pen gesture that commits a shape (issue #15, ADR-PEN-PLACEMENT
 * D1/D5/D6): pen-down records the touch, moves drive a rubber band, pen-up
 * resolves a tap-or-drag target and hands it to `onCommit`. The panel is
 * rendered as `children` so its subtree is untouched by rubber-band
 * re-renders — only this component re-renders while the pen moves.
 *
 * Coordinates are `nativeEvent.pageX/pageY` (root-view-relative dp).
 * `locationX/Y` would re-origin on whichever child the pen is over.
 */
import React, {useCallback, useRef, useState} from 'react';
import {GestureResponderEvent, StyleSheet, View} from 'react-native';
import {
  isDragGesture,
  PageSize,
  PlacementTarget,
  resolvePlacementTarget,
  touchToPage,
} from './placement';
import {Point, Rect} from './lassoTransform';

export const OVERLAY_TEST_IDS = {
  overlay: 'shapes-overlay',
  // Outline drawn while the user drags a box. Present only past the
  // drag threshold.
  rubberBand: 'shapes-rubber-band',
} as const;

/**
 * Minimum interval between rubber-band re-renders. E-ink partial refresh
 * cannot keep up with every move event; the release path clears the band
 * unconditionally, so a skipped final position never lingers.
 */
export const RUBBER_BAND_THROTTLE_MS = 40;

export type PlacementOverlayProps = {
  page: PageSize;
  /** dp → page px multiplier (PixelRatio.get() on device). */
  scale: number;
  onCommit: (target: PlacementTarget) => void;
  children?: React.ReactNode;
};

// Hoisted so the responder prop is referentially stable across renders.
const claimResponder = () => true;

function touchPoint(e: GestureResponderEvent): Point {
  return {x: e.nativeEvent.pageX, y: e.nativeEvent.pageY};
}

export default function PlacementOverlay({
  page,
  scale,
  onCommit,
  children,
}: PlacementOverlayProps) {
  // The pen-down point never needs a re-render; the rubber band does.
  const penDownRef = useRef<Point | null>(null);
  const lastBandAtRef = useRef(0);
  const [rubberBand, setRubberBand] = useState<Rect | null>(null);

  const handleGrant = useCallback((e: GestureResponderEvent) => {
    penDownRef.current = touchPoint(e);
    lastBandAtRef.current = 0;
    setRubberBand(null);
  }, []);

  const handleMove = useCallback(
    (e: GestureResponderEvent) => {
      const down = penDownRef.current;
      if (!down) {return;}
      const now = touchPoint(e);
      // Same page-px rule the release handler uses to classify the
      // gesture, so the band appears exactly when a release would drag.
      if (!isDragGesture(touchToPage(down, scale), touchToPage(now, scale))) {
        setRubberBand(null);
        return;
      }
      const t = Date.now();
      if (t - lastBandAtRef.current < RUBBER_BAND_THROTTLE_MS) {return;}
      lastBandAtRef.current = t;
      setRubberBand({
        left: Math.min(down.x, now.x),
        top: Math.min(down.y, now.y),
        right: Math.max(down.x, now.x),
        bottom: Math.max(down.y, now.y),
      });
    },
    [scale],
  );

  const handleRelease = useCallback(
    (e: GestureResponderEvent) => {
      const up = touchPoint(e);
      // RN never fires release without grant; if it ever did, commit at
      // the release point rather than throw or insert NaN geometry.
      const down = penDownRef.current ?? up;
      penDownRef.current = null;
      setRubberBand(null);
      return onCommit(
        resolvePlacementTarget(touchToPage(down, scale), touchToPage(up, scale), page),
      );
    },
    [onCommit, page, scale],
  );

  const handleTerminate = useCallback(() => {
    penDownRef.current = null;
    setRubberBand(null);
  }, []);

  return (
    <View
      testID={OVERLAY_TEST_IDS.overlay}
      style={styles.container}
      // Android flattens layout-only Views out of the native hierarchy;
      // a flattened view cannot own a responder. Pressable sets this for
      // the same reason.
      collapsable={false}
      onStartShouldSetResponder={claimResponder}
      onResponderGrant={handleGrant}
      onResponderMove={handleMove}
      onResponderRelease={handleRelease}
      onResponderTerminate={handleTerminate}>
      {rubberBand && (
        <View
          testID={OVERLAY_TEST_IDS.rubberBand}
          pointerEvents="none"
          style={[
            styles.rubberBand,
            {
              left: rubberBand.left,
              top: rubberBand.top,
              width: rubberBand.right - rubberBand.left,
              height: rubberBand.bottom - rubberBand.top,
            },
          ]}
        />
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    // `alignItems` is the cross axis for a row flex container, so this
    // vertically centers the panel inside the full-page overlay. Prior
    // to 2026-04-20 the panel was pinned near the top (`top: '2%'`,
    // `alignItems: 'flex-start'`) which looked correct on Nomad but
    // stranded the panel well above the puzzle-piece plugin icon on
    // Manta. Centering gets us close to the icon's Y on both form
    // factors without the SDK needing to expose the button rect.
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  // Drag feedback only — insertion never reads this view. Solid, not
  // dashed: e-ink partial refresh drops dash segments. 2 px so it
  // survives the panel's greyscale rendering.
  rubberBand: {
    position: 'absolute',
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: '#000000',
  },
});
