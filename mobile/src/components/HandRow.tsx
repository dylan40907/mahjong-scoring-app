import React, { useEffect, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  PanResponder,
  PanResponderInstance,
  StyleSheet,
  View,
} from 'react-native';
import { TileFace } from '@/design/components';
import { colors, radius, space } from '@/design/tokens';
import { TILE_BY_CODE, type TileCode } from '@/tiles/tileset';

/**
 * The hand as one row of tiles.
 *
 * One row rather than the detector's groups. Which tiles sit together in a
 * photograph says nothing reliable about which were melded - a player who
 * pushes their hand tidy before you photograph it has erased the spacing - so
 * the grouping is something the player states here rather than something the
 * geometry claims.
 *
 * Reordering has no mode and no button. Hold a tile and it lifts; drag and the
 * others part around it; let go and it lands. Order does not affect the score
 * at all, so it should cost nothing to use and nothing to ignore - putting it
 * behind a mode switch advertised it as a step, which it is not.
 */

export type HandRowMode = 'edit' | 'exposed' | 'winning';

const TILE_WIDTH = 34;
const GAP = 4;
const STRIDE = TILE_WIDTH + GAP;
/** Rows wrap, so a drag has to know which line it is on. */
const ROW_HEIGHT = Math.round(TILE_WIDTH * (4 / 3)) + GAP + 8;

interface Props {
  tiles: readonly TileCode[];
  /** Tiles belonging to an exposed meld. */
  exposed: ReadonlySet<number>;
  /** Tiles the model was unsure about. */
  uncertain?: ReadonlySet<number>;
  selectedTile?: number | null;
  mode: HandRowMode;
  perRow?: number;
  onTilePress: (index: number) => void;
  onReorder: (from: number, to: number) => void;
}

interface DragContext {
  count: number;
  perRow: number;
  originX: number;
  originY: number;
  from: number;
  over: number;
  onReorder: (from: number, to: number) => void;
  setLifted: (index: number | null) => void;
  setOver: (index: number | null) => void;
}

/** Which slot a point inside the row lands in, accounting for wrapping. */
function indexAt(x: number, y: number, count: number, perRow: number): number {
  const column = Math.max(0, Math.min(perRow - 1, Math.floor(x / STRIDE)));
  const row = Math.max(0, Math.floor(y / ROW_HEIGHT));
  return Math.max(0, Math.min(count - 1, row * perRow + column));
}

/**
 * Built once so a drag survives the re-renders it causes. Everything mutable is
 * read from the ref at gesture time rather than captured here.
 */
function makeResponder(context: { current: DragContext }): PanResponderInstance {
  return PanResponder.create({
    // Claims the gesture only after a long press has lifted a tile, so a plain
    // tap still reaches the tile underneath and scrolling still scrolls.
    onStartShouldSetPanResponder: () => context.current.from >= 0,
    onMoveShouldSetPanResponder: () => context.current.from >= 0,
    onPanResponderMove: (event) => {
      const { count, perRow, originX, originY, from } = context.current;
      if (from < 0) return;
      const over = indexAt(
        event.nativeEvent.pageX - originX,
        event.nativeEvent.pageY - originY,
        count,
        perRow,
      );
      if (over !== context.current.over) {
        context.current.over = over;
        context.current.setOver(over);
      }
    },
    onPanResponderRelease: () => {
      const { from, over, onReorder, setLifted, setOver } = context.current;
      if (from >= 0 && over >= 0 && over !== from) onReorder(from, over);
      context.current.from = -1;
      context.current.over = -1;
      setLifted(null);
      setOver(null);
    },
    onPanResponderTerminate: () => {
      context.current.from = -1;
      context.current.over = -1;
      context.current.setLifted(null);
      context.current.setOver(null);
    },
  });
}

export function HandRow({
  tiles,
  exposed,
  uncertain,
  selectedTile,
  mode,
  perRow = 8,
  onTilePress,
  onReorder,
}: Props) {
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [lifted, setLifted] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const context = useRef<DragContext>({
    count: tiles.length,
    perRow,
    originX: 0,
    originY: 0,
    from: -1,
    over: -1,
    onReorder,
    setLifted,
    setOver,
  });

  useEffect(() => {
    context.current.count = tiles.length;
    context.current.perRow = perRow;
    context.current.originX = origin.x;
    context.current.originY = origin.y;
    context.current.onReorder = onReorder;
  }, [tiles.length, perRow, origin, onReorder]);

  /*
   * See HandBoundary for the same pattern: a PanResponder has to outlive the
   * renders a drag provokes, so it is created once and reads current values
   * from a ref inside its callbacks. Nothing reads the ref during render.
   */
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() => makeResponder(context));

  const onLayout = (event: LayoutChangeEvent) => {
    // Gesture coordinates are screen-relative, so the row's own screen
    // position is what turns them into a tile index.
    event.currentTarget.measure?.((_x, _y, _w, _h, pageX, pageY) =>
      setOrigin({ x: pageX ?? 0, y: pageY ?? 0 }),
    );
  };

  const lift = (index: number) => {
    context.current.from = index;
    context.current.over = index;
    setLifted(index);
    setOver(index);
  };

  return (
    <View style={styles.row} onLayout={onLayout} {...responder.panHandlers}>
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
            selected={mode === 'exposed' ? exposed.has(index) : selectedTile === index}
            uncertain={uncertain?.has(index)}
            onPress={() => onTilePress(index)}
            onLongPress={() => lift(index)}
            accessibilityLabel={TILE_BY_CODE[code].label}
            accessibilityHint="Hold and drag to move this tile"
          />
          {exposed.has(index) && mode !== 'exposed' ? <View style={styles.exposedBar} /> : null}
        </View>
      ))}
    </View>
  );
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
  /** A quiet rule under a tile that was declared, not a second colour. */
  exposedBar: {
    marginTop: 3,
    width: TILE_WIDTH - 8,
    height: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.brass,
  },
});

export const HAND_ROW_TILE_WIDTH = TILE_WIDTH;
export const HAND_ROW_GAP = space.xxs;
