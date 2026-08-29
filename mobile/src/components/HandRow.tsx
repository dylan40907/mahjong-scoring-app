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
 * The hand as one row of tiles, in three modes.
 *
 * One row rather than the detector's groups. Which tiles sit together in a
 * photograph says nothing reliable about which were melded - a player who
 * pushes their hand tidy before you photograph it has erased the spacing - so
 * the grouping is something the player states here rather than something the
 * geometry claims.
 *
 * `edit` taps a tile to correct it, `exposed` marks the runs that were melded,
 * and `reorder` drags a tile to a new position, which is what fixes a hand
 * photographed from the far side of the table and read backwards.
 */

export type HandRowMode = 'edit' | 'exposed' | 'reorder' | 'winning';

const TILE_WIDTH = 34;
const GAP = 4;
const STRIDE = TILE_WIDTH + GAP;

interface Props {
  tiles: readonly TileCode[];
  /** Tiles belonging to an exposed meld. */
  exposed: ReadonlySet<number>;
  /** Tiles the model was unsure about. */
  uncertain?: ReadonlySet<number>;
  selectedTile?: number | null;
  mode: HandRowMode;
  onTilePress: (index: number) => void;
  onReorder: (from: number, to: number) => void;
}

interface DragContext {
  count: number;
  origin: number;
  from: number;
  onReorder: (from: number, to: number) => void;
  active: boolean;
}

/** Which slot an x offset within the row falls in. */
function indexAt(x: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.floor(x / STRIDE)));
}

/**
 * Built once so a drag survives the re-renders it causes. Everything mutable
 * is read from the ref at gesture time rather than captured here.
 */
function makeResponder(context: { current: DragContext }): PanResponderInstance {
  return PanResponder.create({
    onStartShouldSetPanResponder: () => context.current.active,
    onMoveShouldSetPanResponder: () => context.current.active,
    onPanResponderGrant: (event) => {
      const { count, origin } = context.current;
      context.current.from = indexAt(event.nativeEvent.pageX - origin, count);
    },
    onPanResponderRelease: (event, gesture) => {
      const { count, origin, from, onReorder } = context.current;
      const to = indexAt(event.nativeEvent.pageX - origin, count);
      // A tap that never moved is not a reorder; leave it to the press handler.
      if (from !== to && Math.abs(gesture.dx) > STRIDE / 2) onReorder(from, to);
      context.current.from = -1;
    },
  });
}

export function HandRow({
  tiles,
  exposed,
  uncertain,
  selectedTile,
  mode,
  onTilePress,
  onReorder,
}: Props) {
  const [rowOrigin, setRowOrigin] = useState(0);

  const context = useRef<DragContext>({
    count: tiles.length,
    origin: 0,
    from: -1,
    onReorder,
    active: mode === 'reorder',
  });

  useEffect(() => {
    context.current.count = tiles.length;
    context.current.origin = rowOrigin;
    context.current.onReorder = onReorder;
    context.current.active = mode === 'reorder';
  }, [tiles.length, rowOrigin, onReorder, mode]);

  /*
   * See HandBoundary for the same pattern: a PanResponder has to outlive the
   * renders a drag provokes, so it is created once and reads current values
   * from a ref inside its callbacks. Nothing reads the ref during render.
   */
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() => makeResponder(context));

  const onLayout = (event: LayoutChangeEvent) => {
    // pageX from the gesture is screen-relative, so the row's own screen x is
    // what turns it into an index.
    event.currentTarget.measure?.((_x, _y, _w, _h, pageX) => setRowOrigin(pageX ?? 0));
  };

  return (
    <View
      style={styles.row}
      onLayout={onLayout}
      {...(mode === 'reorder' ? responder.panHandlers : {})}
    >
      {tiles.map((code, index) => (
        <View key={`${code}-${index}`} style={styles.slot}>
          <TileFace
            code={code}
            width={TILE_WIDTH}
            selected={mode === 'exposed' ? exposed.has(index) : selectedTile === index}
            uncertain={uncertain?.has(index)}
            onPress={mode === 'reorder' ? undefined : () => onTilePress(index)}
            accessibilityLabel={TILE_BY_CODE[code].label}
          />
          {exposed.has(index) && mode !== 'exposed' ? <View style={styles.exposedBar} /> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
  slot: { alignItems: 'center' },
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
