import React from 'react';
import { StyleSheet, View } from 'react-native';
import { TileFace, TileRow } from '@/design/components';
import { tileSize } from '@/design/tokens';
import type { TileCode } from '@/tiles/tileset';

/**
 * Every tile of a hand, laid out as it scored - on a session's hand rows, a
 * profile's best hand, and the breakdown sheet.
 *
 * Grouped by set when the grouping is known (`groupsFrom`), so rows break
 * between sets rather than through them. Otherwise every tile in one row that
 * wraps. Never a slice: a hand with its second half missing is not the hand,
 * and the half that was cut was often the half that made it worth showing.
 */
export function HandTiles({
  groups,
  tiles,
  width = tileSize.sm,
}: {
  groups?: readonly (readonly TileCode[])[] | null;
  tiles: readonly TileCode[];
  width?: number;
}) {
  if (groups && groups.length > 0) {
    return <TileRow groups={groups} width={width} />;
  }
  return (
    <View style={styles.flat}>
      {tiles.map((code, index) => (
        <TileFace key={`${code}-${index}`} code={code} width={width} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flat: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
});
