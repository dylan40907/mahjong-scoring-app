import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PanResponder, PanResponderInstance, StyleSheet, View } from 'react-native';
import { TileFace } from '@/design/components';
import { colors, radius, space } from '@/design/tokens';
import { TILE_BY_CODE, type TileCode } from '@/tiles/tileset';

/**
 * The hand as one row of tiles.
 *
 * One row rather than the detector's groups. Which tiles sit together in a
 * photograph says nothing reliable about which were melded - a player who
 * pushes their hand tidy before you photograph it has erased the spacing - and
 * which tiles form which set is the scorer's job anyway.
 *
 * Two gestures share the row, and which one is live depends on the mode.
 *
 * In edit mode, holding a tile lifts it and dragging moves it; order does not
 * affect the score at all, so it costs nothing to use and nothing to ignore.
 *
 * In exposed mode, a drag *paints*. The player sweeps a finger across the
 * tiles they had already set down and they light up as it passes. This
 * replaced tapping the first tile of a meld and then its last, which asked for
 * two precise taps per meld, made the player think in meld boundaries, and had
 * no answer at all for a concealed kong.
 */

export type HandRowMode = 'edit' | 'exposed' | 'winning';

const TILE_WIDTH = 34;
const GAP = 4;
const STRIDE = TILE_WIDTH + GAP;
/** Rows wrap, so a gesture has to know which line it is on. */
const ROW_HEIGHT = Math.round(TILE_WIDTH * (4 / 3)) + GAP + 8;

interface Props {
  tiles: readonly TileCode[];
  /** Tiles melded before the win. */
  exposed: ReadonlySet<number>;
  selectedTile?: number | null;
  mode: HandRowMode;
  perRow?: number;
  onTilePress: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  /** Exposed mode: the whole new set, as the finger moves. */
  onPaint: (indices: Set<number>) => void;
}

interface GestureContext {
  count: number;
  perRow: number;
  originX: number;
  originY: number;
  mode: HandRowMode;
  exposed: ReadonlySet<number>;
  /** Edit mode: the tile a long press picked up, or -1. */
  from: number;
  over: number;
  /** Exposed mode: whether this stroke is adding or erasing. */
  painting: boolean;
  painted: Set<number>;
  onReorder: (from: number, to: number) => void;
  onPaint: (indices: Set<number>) => void;
  setLifted: (index: number | null) => void;
  setOver: (index: number | null) => void;
  /** Refresh the row's screen position, then run the callback. */
  remeasure: (after?: () => void) => void;
}

/** Which slot a point inside the row lands in, accounting for wrapping. */
function indexAt(x: number, y: number, count: number, perRow: number): number {
  const column = Math.max(0, Math.min(perRow - 1, Math.floor(x / STRIDE)));
  const row = Math.max(0, Math.floor(y / ROW_HEIGHT));
  return Math.max(0, Math.min(count - 1, row * perRow + column));
}

/**
 * Built once so a gesture survives the re-renders it causes. Everything
 * mutable is read from the ref at gesture time rather than captured here.
 */
function makeResponder(context: { current: GestureContext }): PanResponderInstance {
  const at = (pageX: number, pageY: number) => {
    const { count, perRow, originX, originY } = context.current;
    return indexAt(pageX - originX, pageY - originY, count, perRow);
  };

  const paintFrom = (index: number) => {
    const state = context.current;
    if (state.painted.has(index)) return;
    state.painted.add(index);
    const next = new Set(state.exposed);
    for (const i of state.painted) {
      if (state.painting) next.add(i);
      else next.delete(i);
    }
    state.onPaint(next);
  };

  return PanResponder.create({
    // Exposed mode claims the gesture immediately - the whole interaction is
    // the drag. Edit mode claims it only after a long press has lifted a tile,
    // so a plain tap still reaches the tile underneath and a scroll scrolls.
    onStartShouldSetPanResponder: () =>
      context.current.mode === 'exposed' || context.current.from >= 0,
    onMoveShouldSetPanResponder: () =>
      context.current.mode === 'exposed' || context.current.from >= 0,

    onPanResponderGrant: (event) => {
      const state = context.current;
      const { pageX, pageY } = event.nativeEvent;
      /*
       * Re-measure before deciding anything.
       *
       * Gesture coordinates are screen-relative, so the row's own position on
       * screen is what turns them into a tile index - and that changes every
       * time the page scrolls, which layout does not report. Measuring here
       * costs a frame before the stroke starts and is the difference between
       * painting the tile under the finger and painting one two rows away.
       */
      state.remeasure(() => {
        if (state.mode !== 'exposed') return;
        const index = at(pageX, pageY);
        // The first tile touched decides the whole stroke: starting on a
        // marked tile erases, starting on an unmarked one marks. Toggling tile
        // by tile would make a stroke that crosses its own path undo itself.
        state.painting = !state.exposed.has(index);
        state.painted = new Set();
        paintFrom(index);
      });
    },

    onPanResponderMove: (event) => {
      const state = context.current;
      const index = at(event.nativeEvent.pageX, event.nativeEvent.pageY);

      if (state.mode === 'exposed') {
        paintFrom(index);
        return;
      }

      if (state.from < 0) return;
      if (index !== state.over) {
        state.over = index;
        state.setOver(index);
      }
    },

    onPanResponderRelease: () => {
      const state = context.current;
      if (state.mode === 'exposed') {
        state.painted = new Set();
        return;
      }
      const { from, over, onReorder, setLifted, setOver } = state;
      if (from >= 0 && over >= 0 && over !== from) onReorder(from, over);
      state.from = -1;
      state.over = -1;
      setLifted(null);
      setOver(null);
    },

    onPanResponderTerminate: () => {
      const state = context.current;
      state.painted = new Set();
      state.from = -1;
      state.over = -1;
      state.setLifted(null);
      state.setOver(null);
    },
  });
}

export function HandRow({
  tiles,
  exposed,
  selectedTile,
  mode,
  perRow = 8,
  onTilePress,
  onReorder,
  onPaint,
}: Props) {
  const row = useRef<View>(null);
  const [lifted, setLifted] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const context = useRef<GestureContext>({
    count: tiles.length,
    perRow,
    originX: 0,
    originY: 0,
    mode,
    exposed,
    from: -1,
    over: -1,
    painting: true,
    painted: new Set(),
    onReorder,
    onPaint,
    setLifted,
    setOver,
    remeasure: () => undefined,
  });

  // Only ever touches refs, so it is stable and safe to hand to the gesture
  // context; the assignment itself happens in the effect below, after render.
  const measure = useCallback((after?: () => void) => {
    const node = row.current;
    if (!node?.measureInWindow) {
      after?.();
      return;
    }
    node.measureInWindow((x, y) => {
      context.current.originX = x ?? 0;
      context.current.originY = y ?? 0;
      after?.();
    });
  }, []);

  useEffect(() => {
    context.current.count = tiles.length;
    context.current.perRow = perRow;
    context.current.mode = mode;
    context.current.exposed = exposed;
    context.current.onReorder = onReorder;
    context.current.onPaint = onPaint;
    context.current.remeasure = measure;
  }, [tiles.length, perRow, mode, exposed, onReorder, onPaint, measure]);

  /*
   * See HandBoundary for the same pattern: a PanResponder has to outlive the
   * renders a gesture provokes, so it is created once and reads current values
   * from a ref inside its callbacks. Nothing reads the ref during render.
   */
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() => makeResponder(context));

  /*
   * `measureInWindow` on the ref rather than `currentTarget.measure`, which the
   * web renderer does not always provide. A failure leaves the last known
   * origin in place and still runs the callback, so a gesture is never simply
   * swallowed.
   */
  return (
    <View ref={row} style={styles.row} onLayout={() => measure()} {...responder.panHandlers}>
      {tiles.map((code, index) => (
        <View
          key={`${code}-${index}`}
          style={[
            styles.slot,
            // The gap opens where the tile would land, so the row shows the
            // result before you commit to it.
            over === index && lifted !== null && lifted !== index && styles.slotOver,
            lifted === index && styles.slotLifted,
          ]}
        >
          <TileFace
            code={code}
            width={TILE_WIDTH}
            selected={mode === 'winning' && selectedTile === index}
            marked={exposed.has(index)}
            // Painting owns the whole gesture; a tap in that mode would fight
            // the stroke it is part of.
            onPress={mode === 'exposed' ? undefined : () => onTilePress(index)}
            onLongPress={mode === 'edit' ? () => lift(context, index, setLifted, setOver) : undefined}
            accessibilityLabel={TILE_BY_CODE[code].label}
            accessibilityHint={
              mode === 'exposed' ? 'Drag across the tiles everyone saw' : 'Hold and drag to move this tile'
            }
          />
          {exposed.has(index) && mode !== 'exposed' ? <View style={styles.meldedBar} /> : null}
        </View>
      ))}
    </View>
  );
}

function lift(
  context: { current: GestureContext },
  index: number,
  setLifted: (i: number | null) => void,
  setOver: (i: number | null) => void,
) {
  context.current.from = index;
  context.current.over = index;
  setLifted(index);
  setOver(index);
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  slot: { alignItems: 'center' },
  slotLifted: { opacity: 0.35 },
  slotOver: {
    borderLeftWidth: 2,
    borderLeftColor: colors.brass,
    marginLeft: -2,
    borderRadius: radius.sm,
  },
  /** A quiet rule under a tile that was set down, in the melded colour. */
  meldedBar: {
    marginTop: 3,
    width: TILE_WIDTH - 8,
    height: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.melded,
  },
});

export const HAND_ROW_TILE_WIDTH = TILE_WIDTH;
export const HAND_ROW_GAP = space.xxs;
