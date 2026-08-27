import React, { useCallback, useMemo, useState } from 'react';
import { Image, LayoutChangeEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Body,
  Button,
  Caption,
  CaptionStrong,
  Screen,
  Section,
  TileFace,
} from '@/design/components';
import { AlertIcon, PlusIcon } from '@/design/icons';
import { colors, radius, space, tileSize } from '@/design/tokens';
import { TilePicker } from '@/components/TilePicker';
import type { TileCode } from '@/tiles/tileset';
import { TILE_BY_CODE, isBonus } from '@/tiles/tileset';
import { findRuleSet } from '@/store/store';
import {
  appendTile,
  classifyMeld,
  getDraft,
  removeBonus,
  removeTile,
  setTile,
  toggleMeldGroup,
  updateDraft,
  useDraft,
  validateDraft,
} from '@/store/draft';

/**
 * Reviewing what the model read.
 *
 * The design assumption is that the model is usually right and occasionally
 * wrong, so the screen optimises for scanning rather than for editing: the
 * hand is shown as tiles at a size you can read at a glance, low-confidence
 * detections are marked, and correcting one is a tap. Nothing has to be
 * confirmed tile by tile.
 *
 * Everything the detector inferred is presented as a proposal. Which groups
 * are exposed melds is a guess from spacing, and the winning tile cannot be
 * seen in a photograph at all, so both are stated plainly and are one tap to
 * change.
 */
export default function ReviewScreen() {
  const router = useRouter();
  const draft = useDraft(useCallback((d) => d, []));
  const rules = findRuleSet(draft.ruleSetId);
  const handSize = rules?.handSize ?? 16;

  const [mode, setMode] = useState<'edit' | 'winning'>('edit');
  const [picker, setPicker] = useState<
    { group: number; tile: number } | { group: -1; tile: -1 } | null
  >(null);

  const validation = useMemo(() => validateDraft(draft, handSize), [draft, handSize]);
  const flagged = useMemo(() => new Set(draft.flagged), [draft.flagged]);

  const detectionFor = (groupIndex: number, tileIndex: number) => {
    let position = 0;
    for (let g = 0; g < groupIndex; g += 1) position += draft.groups[g].length;
    return draft.detections[position + tileIndex];
  };

  const handleTilePress = (groupIndex: number, tileIndex: number) => {
    if (mode === 'winning') {
      updateDraft({ winningTile: draft.groups[groupIndex][tileIndex] });
      setMode('edit');
      return;
    }
    setPicker({ group: groupIndex, tile: tileIndex });
  };

  const handleSelect = (code: TileCode) => {
    if (!picker) return;
    if (picker.group === -1) {
      appendTile(code);
    } else if (isBonus(TILE_BY_CODE[code])) {
      // A flower can only have been read as a hand tile by mistake; move it to
      // where flowers belong rather than leaving it in the hand.
      removeTile(picker.group, picker.tile);
      appendTile(code);
    } else {
      setTile(picker.group, picker.tile, code);
    }
    setPicker(null);
  };

  const activeDetection =
    picker && picker.group >= 0 ? detectionFor(picker.group, picker.tile) : undefined;

  return (
    <Screen padded={false} footerSpace={0}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {draft.photoUri ? <PhotoWithBoxes uri={draft.photoUri} draft={draft} /> : null}

        <View style={styles.statusRow}>
          <CaptionStrong tone={validation.tileCount === validation.expected ? 'muted' : 'loss'} numeric>
            {validation.tileCount} of {validation.expected} tiles
          </CaptionStrong>
          {flagged.size > 0 ? (
            <View style={styles.flagNote}>
              <AlertIcon size={14} color={colors.loss} />
              <Caption tone="loss">{flagged.size} to check</Caption>
            </View>
          ) : null}
        </View>

        <Section title={mode === 'winning' ? 'Tap the winning tile' : 'The hand'} first>
          <View style={styles.groups}>
            {draft.groups.map((group, groupIndex) => {
              const isMeld = draft.meldGroups.includes(groupIndex);
              const meld = isMeld ? classifyMeld(group, false) : null;
              return (
                <View key={groupIndex} style={styles.group}>
                  <View style={styles.groupTiles}>
                    {group.map((code, tileIndex) => (
                      <TileFace
                        key={`${groupIndex}-${tileIndex}`}
                        code={code}
                        width={REVIEW_TILE_WIDTH}
                        selected={
                          mode === 'winning'
                            ? false
                            : draft.winningTile === code &&
                              isWinningPosition(draft, groupIndex, tileIndex)
                        }
                        uncertain={flagged.has(`${groupIndex}:${tileIndex}`)}
                        onPress={() => handleTilePress(groupIndex, tileIndex)}
                        accessibilityLabel={TILE_BY_CODE[code].label}
                      />
                    ))}
                  </View>
                  {group.length > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => toggleMeldGroup(groupIndex)}
                      style={({ pressed }) => [styles.groupLabel, pressed && styles.pressed]}
                    >
                      <Caption tone={isMeld ? 'accent' : 'faint'}>
                        {isMeld ? (meld ? capitalise(meld.kind) : 'Not a valid meld') : 'Concealed'}
                      </Caption>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a tile"
              onPress={() => setPicker({ group: -1, tile: -1 })}
              style={({ pressed }) => [styles.addTile, pressed && styles.pressed]}
            >
              <PlusIcon size={20} color={colors.inkFaint} />
            </Pressable>
          </View>
          <Caption tone="faint" style={styles.hint}>
            Tap a tile to correct it. Tap the label under a group to mark it as an exposed meld.
          </Caption>
        </Section>

        <Section title="Winning tile">
          <View style={styles.winning}>
            {draft.winningTile ? (
              <>
                <TileFace code={draft.winningTile} width={tileSize.md} />
                <Body tone="muted" style={styles.winningLabel}>
                  {TILE_BY_CODE[draft.winningTile].label}
                </Body>
              </>
            ) : (
              <Body tone="loss" style={styles.winningLabel}>
                Not chosen yet
              </Body>
            )}
            <Button
              label={mode === 'winning' ? 'Cancel' : 'Choose'}
              variant="ghost"
              onPress={() => setMode(mode === 'winning' ? 'edit' : 'winning')}
            />
          </View>
        </Section>

        {rules?.usesBonusTiles ? (
          <Section title="Flowers & seasons" note={draft.bonus.length === 0 ? 'None' : undefined}>
            <View style={styles.bonus}>
              {draft.bonus.map((code, index) => (
                <TileFace
                  key={`${code}-${index}`}
                  code={code}
                  width={tileSize.sm}
                  onPress={() => removeBonus(index)}
                  accessibilityLabel={`Remove ${TILE_BY_CODE[code].label}`}
                />
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add a flower or season"
                onPress={() => setPicker({ group: -1, tile: -1 })}
                style={({ pressed }) => [styles.addBonus, pressed && styles.pressed]}
              >
                <PlusIcon size={16} color={colors.inkFaint} />
              </Pressable>
            </View>
          </Section>
        ) : null}

        {validation.problems.length > 0 ? (
          <View style={styles.problems}>
            {validation.problems.map((problem) => (
              <Caption key={problem} tone="loss">
                {problem}
              </Caption>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label="Continue"
          variant="primary"
          block
          disabled={!validation.ok}
          onPress={() => router.push('/hand/context')}
        />
      </View>

      <TilePicker
        visible={picker !== null}
        onClose={() => setPicker(null)}
        onSelect={handleSelect}
        onRemove={
          picker && picker.group >= 0
            ? () => {
                removeTile(picker.group, picker.tile);
                setPicker(null);
              }
            : undefined
        }
        alternatives={activeDetection?.alternatives}
        current={picker && picker.group >= 0 ? draft.groups[picker.group]?.[picker.tile] : null}
        title={picker?.group === -1 ? 'Add a tile' : 'Correct this tile'}
        includeBonus={rules?.usesBonusTiles ?? true}
      />
    </Screen>
  );
}

/**
 * The photograph with the detector's boxes drawn over it.
 *
 * Worth the space: it is the only place the user can see *why* a tile was read
 * the way it was. A box drawn around the wrong thing explains a wrong tile
 * immediately, where a list of tile names would leave them guessing.
 */
function PhotoWithBoxes({ uri, draft }: { uri: string; draft: ReturnType<typeof getDraft> }) {
  const [layout, setLayout] = useState({ width: 0, height: 0 });

  const source = useMemo(() => {
    if (draft.detections.length === 0) return null;
    let maxX = 0;
    let maxY = 0;
    for (const detection of draft.detections) {
      maxX = Math.max(maxX, detection.box[2]);
      maxY = Math.max(maxY, detection.box[3]);
    }
    return { width: maxX, height: maxY };
  }, [draft.detections]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout({ width, height });
  };

  // Boxes are in decoded-image pixels; the preview is letterboxed by `contain`,
  // so the same fit has to be reproduced to place them.
  const fit = useMemo(() => {
    if (!source || layout.width === 0) return null;
    const scale = Math.min(layout.width / source.width, layout.height / source.height);
    return {
      scale,
      offsetX: (layout.width - source.width * scale) / 2,
      offsetY: (layout.height - source.height * scale) / 2,
    };
  }, [source, layout]);

  return (
    <View style={styles.photo} onLayout={onLayout}>
      <Image source={{ uri }} style={styles.photoImage} resizeMode="contain" />
      {fit
        ? draft.detections.map((detection, index) => (
            <View
              key={index}
              pointerEvents="none"
              style={[
                styles.box,
                {
                  left: detection.box[0] * fit.scale + fit.offsetX,
                  top: detection.box[1] * fit.scale + fit.offsetY,
                  width: (detection.box[2] - detection.box[0]) * fit.scale,
                  height: (detection.box[3] - detection.box[1]) * fit.scale,
                  borderColor: detection.confidence < 0.6 ? colors.loss : colors.brass,
                },
              ]}
            />
          ))
        : null}
    </View>
  );
}

function isWinningPosition(
  draft: ReturnType<typeof getDraft>,
  groupIndex: number,
  tileIndex: number,
): boolean {
  if (!draft.winningTile) return false;
  for (let g = 0; g < draft.groups.length; g += 1) {
    for (let t = 0; t < draft.groups[g].length; t += 1) {
      if (draft.groups[g][t] === draft.winningTile) return g === groupIndex && t === tileIndex;
    }
  }
  return false;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Sized so nine tiles fit across a narrow phone: a seventeen-tile hand lands on
 * two tidy rows rather than three ragged ones.
 */
const REVIEW_TILE_WIDTH = 34;

/** Enough to scroll the last row clear of the fixed action bar. */
const FOOTER_CLEARANCE = 96;

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.xl, paddingBottom: FOOTER_CLEARANCE },
  photo: {
    height: 180,
    marginTop: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.well,
    overflow: 'hidden',
  },
  photoImage: { width: '100%', height: '100%' },
  box: { position: 'absolute', borderWidth: 1.5, borderRadius: 2 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.lg,
    paddingHorizontal: space.xs,
  },
  flagNote: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  groups: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, alignItems: 'flex-start' },
  // A concealed Taiwanese hand is seventeen tiles - far wider than a phone -
  // so a group has to be allowed to wrap. Tiles within a group stay two pixels
  // apart and groups sixteen, which keeps melds legible as separate units even
  // when one of them wraps onto a second line.
  group: { alignItems: 'flex-start', gap: space.xs, maxWidth: '100%' },
  groupTiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, maxWidth: '100%' },
  groupLabel: { paddingVertical: space.xs, paddingHorizontal: space.sm },
  addTile: {
    width: REVIEW_TILE_WIDTH,
    height: Math.round(REVIEW_TILE_WIDTH * (4 / 3)),
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBonus: {
    width: tileSize.sm,
    height: Math.round(tileSize.sm * (4 / 3)),
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { marginTop: space.lg, paddingHorizontal: space.xs },
  winning: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  winningLabel: { flex: 1 },
  bonus: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  problems: { marginTop: space.xl, gap: space.xs, paddingHorizontal: space.xs },
  pressed: { opacity: 0.6 },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.ground,
  },
});
