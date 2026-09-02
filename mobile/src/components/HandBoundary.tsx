import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  LayoutChangeEvent,
  PanResponder,
  PanResponderInstance,
  StyleSheet,
  View,
} from 'react-native';
import { colors, radius, space } from '@/design/tokens';
import { clampBox, type Box } from '@/vision/boundary';
import { containFit, placeBox, type ContainFit } from '@/vision/overlay';
import { CAPTURE_ASPECT } from '@/vision/frame';

/**
 * The photograph with one box around the hand.
 *
 * One box, and nothing else drawn on the photograph.
 *
 * A per-tile overlay answers a question nobody asked: the review screen already
 * shows what each tile was read as, at a size you can actually see. Boxes
 * scattered over the picture only made it look busy and unfinished, and they
 * competed with the one thing the photograph is here for - deciding whether
 * something outside the hand got into shot.
 *
 * The box starts as the whole picture, because the picture has already been
 * cropped to the frame the user aimed. Dragging a corner in is a correction,
 * not a confirmation, so there is nothing to do here in the ordinary case.
 *
 * Which is exactly why the corners have to be reachable when it *is* the
 * ordinary case. The photograph used to be clipped to a rounded rectangle and
 * the handles drawn inside it, so at the default full-frame box all four
 * handles were half-eaten by the corner radius and the two on the right were
 * effectively untouchable. The image is clipped; the overlay is not. It sits
 * in a container inset by half a handle, which is space the handles need and
 * nothing else uses.
 */

/** Touch target for a corner, comfortably past the 44pt minimum at the edges. */
const HANDLE_HIT = 44;
/** Room around the photograph for the half of each handle that overhangs it. */
const INSET = HANDLE_HIT / 2;

type Corner = 'tl' | 'tr' | 'bl' | 'br';
const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];

interface Props {
  uri: string;
  imageWidth: number;
  imageHeight: number;
  boundary: Box | null;
  onChange: (boundary: Box) => void;
}

/**
 * Everything a drag needs, read at the moment it happens rather than captured
 * when the responder was built. The responders are created once; the values
 * they act on change on every render.
 */
interface DragContext {
  boundary: Box | null;
  fit: ContainFit | null;
  imageWidth: number;
  imageHeight: number;
  onChange: (boundary: Box) => void;
  /** The box as it was when the current drag began. */
  start: Box | null;
}

/** Keep x0 < x1 and y0 < y1 after a corner is dragged past its opposite. */
function normalise(box: Box): Box {
  return [
    Math.min(box[0], box[2]),
    Math.min(box[1], box[3]),
    Math.max(box[0], box[2]),
    Math.max(box[1], box[3]),
  ];
}

function moveCorner(corner: Corner, start: Box, dx: number, dy: number): Box {
  switch (corner) {
    case 'tl':
      return [start[0] + dx, start[1] + dy, start[2], start[3]];
    case 'tr':
      return [start[0], start[1] + dy, start[2] + dx, start[3]];
    case 'bl':
      return [start[0] + dx, start[1], start[2], start[3] + dy];
    case 'br':
      return [start[0], start[1], start[2] + dx, start[3] + dy];
  }
}

/**
 * Built outside the component so the responders never close over render-time
 * values, and so nothing that touches a ref is constructed during render.
 */
function makeResponders(
  context: { current: DragContext },
): Record<Corner, PanResponderInstance> {
  const forCorner = (corner: Corner) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        context.current.start = context.current.boundary;
      },
      onPanResponderMove: (_event, gesture) => {
        const { start, fit, imageWidth, imageHeight, onChange } = context.current;
        if (!start || !fit || fit.scale === 0) return;
        // Screen pixels back into image pixels.
        const next = moveCorner(corner, start, gesture.dx / fit.scale, gesture.dy / fit.scale);
        onChange(clampBox(normalise(next), imageWidth, imageHeight));
      },
      onPanResponderRelease: () => {
        context.current.start = null;
      },
      onPanResponderTerminate: () => {
        context.current.start = null;
      },
    });

  return { tl: forCorner('tl'), tr: forCorner('tr'), bl: forCorner('bl'), br: forCorner('br') };
}

function handlePosition(
  corner: Corner,
  placed: { left: number; top: number; width: number; height: number },
) {
  const x = corner === 'tl' || corner === 'bl' ? placed.left : placed.left + placed.width;
  const y = corner === 'tl' || corner === 'tr' ? placed.top : placed.top + placed.height;
  // Handles live in the outer container, which is inset by half a handle, so
  // the image-space position has to be shifted into it.
  return { left: x + INSET - HANDLE_HIT / 2, top: y + INSET - HANDLE_HIT / 2 };
}

export function HandBoundary({
  uri,
  imageWidth,
  imageHeight,
  boundary,
  onChange,
}: Props) {
  const [layout, setLayout] = useState({ width: 0, height: 0 });

  const source = useMemo(
    () => (imageWidth > 0 && imageHeight > 0 ? { width: imageWidth, height: imageHeight } : null),
    [imageWidth, imageHeight],
  );
  const fit = useMemo(() => containFit(source, layout), [source, layout]);

  const context = useRef<DragContext>({
    boundary,
    fit,
    imageWidth,
    imageHeight,
    onChange,
    start: null,
  });

  // Refreshed after render rather than during it, so a drag in flight always
  // reads the values the screen is currently showing.
  useEffect(() => {
    context.current.boundary = boundary;
    context.current.fit = fit;
    context.current.imageWidth = imageWidth;
    context.current.imageHeight = imageHeight;
    context.current.onChange = onChange;
  }, [boundary, fit, imageWidth, imageHeight, onChange]);

  /*
   * Built once, on the first render, and never rebuilt: PanResponder instances
   * have to be stable or a drag is dropped the moment anything re-renders,
   * which here is every frame of the drag itself.
   *
   * The rule fires because a ref is handed to a function called during render.
   * Nothing reads `context.current` at that point - `makeResponders` only
   * stores the reference, and the reads happen later inside gesture callbacks.
   * Passing the values directly is what would actually be wrong, since the
   * responders would then act on whatever the box was when they were created.
   */
  // eslint-disable-next-line react-hooks/refs
  const [responders] = useState(() => makeResponders(context));

  const placed = fit && boundary ? placeBox(boundary, fit) : null;

  return (
    <View style={styles.frame}>
      <View
        style={styles.photo}
        onLayout={(event: LayoutChangeEvent) => setLayout(event.nativeEvent.layout)}
      >
        <Image source={{ uri }} style={styles.photoImage} resizeMode="contain" />
      </View>

      {placed ? (
        <>
          <View
            pointerEvents="none"
            style={[styles.boundary, { left: placed.left + INSET, top: placed.top + INSET, width: placed.width, height: placed.height }]}
          />
          {CORNERS.map((corner) => (
            <View
              key={corner}
              accessibilityRole="adjustable"
              accessibilityLabel={`Drag to resize the hand area`}
              {...responders[corner].panHandlers}
              style={[styles.handle, handlePosition(corner, placed)]}
            >
              <View style={styles.handleDot} />
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  /** Holds the overlay, and is the only thing that does not clip. */
  frame: { marginTop: space.sm, padding: INSET },
  // The same shape the capture frame was, so a photograph taken in the app
  // fills it exactly and one chosen from the library letterboxes honestly.
  photo: {
    width: '100%',
    aspectRatio: CAPTURE_ASPECT,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
    backgroundColor: colors.well,
  },
  photoImage: { width: '100%', height: '100%' },
  boundary: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.brass,
    borderRadius: radius.sm,
  },
  handle: {
    position: 'absolute',
    width: HANDLE_HIT,
    height: HANDLE_HIT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.brass,
    borderWidth: 2,
    borderColor: colors.surface,
  },
});
