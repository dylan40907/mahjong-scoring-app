import React from 'react';
import { StyleSheet, View } from 'react-native';
import { TileFace, TileRow } from '@/design/components';
import { tileSize } from '@/design/tokens';
import type { TileCode } from '@/tiles/tileset';

/**
 * Every tile of a best hand, on a profile - yours or somebody else's.
 *
 * Grouped by set when the grouping is known (`handGroups`), so the rows break
 * between sets rather than through them. Otherwise every tile in one row that
 * wraps. Never a slice: a best hand with its second half missing is not the
 * hand, and the half that was cut was often the half that made it the best.
 */
export function BestHandTiles({
  groups,
  tiles,
}: {
  groups?: readonly (readonly TileCode[])[] | null;
  tiles: readonly TileCode[];
}) {
  if (groups && groups.length > 0) {
    return <TileRow groups={groups} width={tileSize.sm} />;
  }
  return (
    <View style={styles.flat}>
      {tiles.map((code, index) => (
        <TileFace key={`${code}-${index}`} code={code} width={tileSize.sm} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flat: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
});
