import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Body,
  Button,
  Caption,
  CaptionStrong,
  Screen,
  Section,
  TileFace,
  TileScanner,
} from '@/design/components';
import { AlertIcon, PlusIcon } from '@/design/icons';
import { colors, radius, space, tileSize } from '@/design/tokens';
import { TilePicker } from '@/components/TilePicker';
import { HandBoundary } from '@/components/HandBoundary';
import { HandRow, type HandRowMode } from '@/components/HandRow';
import { exposedIndices } from '@/store/melds';
import { withinBoundary } from '@/vision/boundary';
import { detectTiles } from '@/vision/detector';
import { orderDetections } from '@/vision/ordering';
import { findRuleSet, useAppState } from '@/store/store';
import type { TileCode } from '@/tiles/tileset';
import { TILE_BY_CODE, isBonus } from '@/tiles/tileset';
import {
  appendTile,
  exposedSpans,
  handTiles,
  reorderTile,
  setExposedSpans,
  removeBonus,
  removeTile,
  setTile,
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

  const settings = useAppState(useCallback((state) => state.settings, []));
  const [rereading, setRereading] = useState(false);
  const [mode, setMode] = useState<HandRowMode>('edit');

  /** Detection indices the model was unsure about, for the faint boxes. */
  const uncertainIndices = useMemo(() => {
    const set = new Set<number>();
    draft.detections.forEach((detection, index) => {
      if (detection.confidence < settings.confidenceThreshold) set.add(index);
    });
    return set;
  }, [draft.detections, settings.confidenceThreshold]);

  /**
   * Read the hand again, this time seeing only what the boundary holds.
   *
   * Two things change. Tiles outside the box stop existing, so the wall behind
   * the hand cannot contribute. And the detector's 320-pixel input is spent
   * entirely on the hand rather than on the whole table, which for a hand
   * filling a fifth of the frame is several times more pixels per tile.
   */
  const reread = useCallback(async () => {
    if (!draft.photoUri || !draft.boundary) return;
    setRereading(true);
    try {
      const result = await detectTiles(draft.photoUri, { region: draft.boundary });
      const inside = withinBoundary(result.detections, draft.boundary);
      const ordered = orderDetections(inside);
      const flagged: string[] = [];
      ordered.groups.forEach((group, groupIndex) => {
        group.forEach((tile, tileIndex) => {
          if (tile.confidence < settings.confidenceThreshold) {
            flagged.push(`${groupIndex}:${tileIndex}`);
          }
        });
      });
      updateDraft({
        groups: ordered.groups.map((group) => group.map((tile) => tile.code)),
        meldGroups: [],
        detections: inside,
        imageWidth: result.imageWidth,
        imageHeight: result.imageHeight,
        flagged,
      });
    } catch {
      // Keep the read we already have; the tiles are still editable by hand.
    } finally {
      setRereading(false);
    }
  }, [draft.photoUri, draft.boundary, settings.confidenceThreshold]);
  const [picker, setPicker] = useState<
    { group: number; tile: number } | { group: -1; tile: -1 } | null
  >(null);

  const validation = useMemo(() => validateDraft(draft, handSize), [draft, handSize]);

  /** The hand as one row; groups exist for the scorer, not for the player. */
  // eslint-disable-next-line react-hooks/exhaustive-deps -- groups is the only input
  const tiles = useMemo(() => handTiles(draft), [draft.groups]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- groups and meldGroups are the only inputs
  const spans = useMemo(() => exposedSpans(draft), [draft.groups, draft.meldGroups]);
  const exposedSet = useMemo(() => exposedIndices(spans), [spans]);

  /** Flagged positions arrive as "group:index"; the row works in flat indices. */
  const uncertainTiles = useMemo(() => {
    const set = new Set<number>();
    let offset = 0;
    draft.groups.forEach((group, groupIndex) => {
      group.forEach((_tile, tileIndex) => {
        if (draft.flagged.includes(`${groupIndex}:${tileIndex}`)) set.add(offset + tileIndex);
      });
      offset += group.length;
    });
    return set;
  }, [draft.groups, draft.flagged]);

  const winningIndex = useMemo(
    () => (draft.winningTile ? tiles.indexOf(draft.winningTile) : null),
    [tiles, draft.winningTile],
  );

  const [spanStart, setSpanStart] = useState<number | null>(null);

  const handleTilePress = (index: number) => {
    if (mode === 'winning') {
      updateDraft({ winningTile: tiles[index] });
      setMode('edit');
      return;
    }

    if (mode === 'exposed') {
      // Tapping inside an existing meld removes it, which is the only way back
      // from a mistake and needs no separate control.
      const covering = spans.findIndex(([from, to]) => index >= from && index <= to);
      if (covering >= 0) {
        setExposedSpans(spans.filter((_span, i) => i !== covering));
        setSpanStart(null);
        return;
      }
      if (spanStart === null) {
        setSpanStart(index);
      } else {
        setExposedSpans([...spans, [spanStart, index]]);
        setSpanStart(null);
      }
      return;
    }

    setPicker({ group: index, tile: index });
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
    picker && picker.group >= 0 ? draft.detections[picker.group] : undefined;

  return (
    <Screen padded={false} footerSpace={0}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {draft.photoUri ? (
          <>
            <HandBoundary
              uri={draft.photoUri}
              imageWidth={draft.imageWidth}
              imageHeight={draft.imageHeight}
              boundary={draft.boundary}
              detections={draft.detections}
              uncertain={uncertainIndices}
              onChange={(next) => updateDraft({ boundary: next })}
            />
            {rereading ? (
              <View style={styles.rereadBusy}>
                <TileScanner label="Reading that area again…" />
              </View>
            ) : null}
            <View style={styles.rereadRow}>
              <Caption tone="faint" style={styles.rereadHint}>
                Drag a corner so the box holds only your hand.
              </Caption>
              <Button
                label={rereading ? 'Reading…' : 'Read again'}
                variant="ghost"
                disabled={rereading || !draft.boundary}
                onPress={reread}
              />
            </View>
          </>
        ) : null}

        <View style={styles.statusRow}>
          <CaptionStrong tone={validation.tileCount === validation.expected ? 'muted' : 'loss'} numeric>
            {validation.tileCount} of {validation.expected} tiles
          </CaptionStrong>
          {uncertainTiles.size > 0 ? (
            <View style={styles.flagNote}>
              <AlertIcon size={14} color={colors.loss} />
              <Caption tone="loss">{uncertainTiles.size} to check</Caption>
            </View>
          ) : null}
        </View>

        <Section
          title={
            mode === 'winning' ? 'Tap the winning tile'
            : mode === 'exposed' ? 'Mark what was exposed'
            : 'The hand'
          }
          first
        >
          <HandRow
            tiles={tiles}
            exposed={exposedSet}
            uncertain={uncertainTiles}
            selectedTile={winningIndex}
            mode={mode}
            onTilePress={handleTilePress}
            onReorder={reorderTile}
          />

          <View style={styles.handActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a tile"
              onPress={() => setPicker({ group: -1, tile: -1 })}
              style={({ pressed }) => [styles.addTile, pressed && styles.pressed]}
            >
              <PlusIcon size={20} color={colors.inkFaint} />
            </Pressable>
            <Button
              label={mode === 'exposed' ? 'Done' : 'Exposed melds'}
              variant="ghost"
              onPress={() => {
                setSpanStart(null);
                setMode(mode === 'exposed' ? 'edit' : 'exposed');
              }}
            />
          </View>

          <Caption tone="faint" style={styles.hint}>
            {mode === 'exposed'
              ? spanStart === null
                ? 'Tap the first tile of a meld you declared. Tap a marked tile to unmark it.'
                : 'Now tap the last tile of that meld.'
              : 'Tap a tile to correct it, or hold and drag to move it. Everything is concealed unless you mark it exposed.'}
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
          label="Score the Hand"
          variant="primary"
          block
          disabled={!validation.ok}
          onPress={() => router.push('/hand/result')}
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
 * Sized so nine tiles fit across a narrow phone: a seventeen-tile hand lands on
 * two tidy rows rather than three ragged ones.
 */
const REVIEW_TILE_WIDTH = 34;

/** Enough to scroll the last row clear of the fixed action bar. */
const FOOTER_CLEARANCE = 96;

const styles = StyleSheet.create({
  rereadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginTop: space.xs,
  },
  rereadHint: { flex: 1 },
  rereadBusy: { alignItems: 'center', marginTop: space.sm },
  handActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.sm,
  },
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
