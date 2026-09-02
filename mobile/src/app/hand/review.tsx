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
import { PlusIcon } from '@/design/icons';
import { colors, radius, space, tileSize } from '@/design/tokens';
import { TilePicker } from '@/components/TilePicker';
import { HandBoundary } from '@/components/HandBoundary';
import { HandRow, type HandRowMode } from '@/components/HandRow';
import { concealedIndices, meldedIndices, type DeclaredMeld } from '@/store/melds';
import { withinBoundary } from '@/vision/boundary';
import { detectTiles } from '@/vision/detector';
import { orderDetections } from '@/vision/ordering';
import { findRuleSet } from '@/store/store';
import type { TileCode } from '@/tiles/tileset';
import { TILE_BY_CODE, isBonus } from '@/tiles/tileset';
import {
  appendTile,
  declaredMeldsOf,
  handTiles,
  reorderTile,
  setDeclaredMelds,
  removeBonus,
  removeTileAt,
  setTileAt,
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
 * Nothing the detector inferred is treated as fact. Which tiles were declared
 * and which tile completed the hand are both invisible to a camera, so the
 * player states them here rather than having them guessed at.
 */
export default function ReviewScreen() {
  const router = useRouter();
  const draft = useDraft(useCallback((d) => d, []));
  const rules = findRuleSet(draft.ruleSetId);
  const handSize = rules?.handSize ?? 16;

  const [rereading, setRereading] = useState(false);
  const [mode, setMode] = useState<HandRowMode>('edit');

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
      updateDraft({
        groups: ordered.groups.map((group) => group.map((tile) => tile.code)),
        meldGroups: [],
        concealedMelds: [],
        detections: inside,
        imageWidth: result.imageWidth,
        imageHeight: result.imageHeight,
      });
    } catch {
      // Keep the read we already have; the tiles are still editable by hand.
    } finally {
      setRereading(false);
    }
  }, [draft.photoUri, draft.boundary]);

  /** The tile the picker is editing. -1 means it is adding a new one. */
  const [picker, setPicker] = useState<number | null>(null);

  const validation = useMemo(() => validateDraft(draft, handSize), [draft, handSize]);

  /** The hand as one row; groups exist for the scorer, not for the player. */
  // eslint-disable-next-line react-hooks/exhaustive-deps -- groups is the only input
  const tiles = useMemo(() => handTiles(draft), [draft.groups]);
  const melds = useMemo(
    () => declaredMeldsOf(draft),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- these three are the only inputs
    [draft.groups, draft.meldGroups, draft.concealedMelds],
  );
  const declaredSet = useMemo(() => meldedIndices(melds), [melds]);
  const concealedSet = useMemo(() => concealedIndices(melds), [melds]);

  const winningIndex = useMemo(
    () => (draft.winningTile ? tiles.indexOf(draft.winningTile) : null),
    [tiles, draft.winningTile],
  );

  const [meldStart, setMeldStart] = useState<number | null>(null);

  /** Four identical tiles set down together: the one meld that can be concealed. */
  const isKong = (meld: DeclaredMeld) => {
    const run = tiles.slice(meld.start, meld.end + 1);
    return run.length === 4 && run.every((code) => code === run[0]);
  };

  const handleTilePress = (index: number) => {
    if (mode === 'winning') {
      updateDraft({ winningTile: tiles[index] });
      setMode('edit');
      return;
    }

    if (mode === 'melds') {
      const covering = melds.findIndex((meld) => index >= meld.start && index <= meld.end);
      if (covering >= 0) {
        /*
         * Tapping a marked meld cycles it rather than only clearing it.
         *
         * A kong has a third state - set down, but never shown - and it is not
         * a nicety: a concealed kong leaves a Riichi hand closed, so riichi,
         * menzen tsumo and pinfu all survive it, and Taiwanese and MCR both
         * pay it more than a melded one. A dedicated control for it would have
         * been meaningless for every meld that is not four of a kind.
         */
        const meld = melds[covering];
        setDeclaredMelds(
          !meld.concealed && isKong(meld)
            ? melds.map((m, i) => (i === covering ? { ...m, concealed: true } : m))
            : melds.filter((_m, i) => i !== covering),
        );
        setMeldStart(null);
        return;
      }
      if (meldStart === null) {
        setMeldStart(index);
      } else {
        setDeclaredMelds([
          ...melds,
          { start: Math.min(meldStart, index), end: Math.max(meldStart, index), concealed: false },
        ]);
        setMeldStart(null);
      }
      return;
    }

    setPicker(index);
  };

  const handleSelect = (code: TileCode) => {
    if (picker === null) return;
    if (picker < 0) {
      appendTile(code);
    } else if (isBonus(TILE_BY_CODE[code])) {
      // A flower can only have been read as a hand tile by mistake; move it to
      // where flowers belong rather than leaving it in the hand.
      removeTileAt(picker);
      appendTile(code);
    } else {
      setTileAt(picker, code);
    }
    setPicker(null);
  };

  const activeDetection = picker !== null && picker >= 0 ? draft.detections[picker] : undefined;

  return (
    <Screen padded={false} footerSpace={0}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!draft.photoUri ? (
          <Button
            label="Add a photo"
            variant="ghost"
            block
            onPress={() => router.push('/hand/capture')}
            style={styles.addPhoto}
          />
        ) : null}
        {draft.photoUri ? (
          <>
            <HandBoundary
              uri={draft.photoUri}
              imageWidth={draft.imageWidth}
              imageHeight={draft.imageHeight}
              boundary={draft.boundary}
              onChange={(next) => updateDraft({ boundary: next })}
            />
            {rereading ? (
              <View style={styles.rereadBusy}>
                <TileScanner label="Reading that area again…" />
              </View>
            ) : null}
            <Caption tone="faint" style={styles.photoHint}>
              Everything in the frame was read. Drag a corner in to leave something out, then read
              it again.
            </Caption>
            <View style={styles.photoActions}>
              <Button
                label="Retake"
                variant="ghost"
                style={styles.photoAction}
                onPress={() => router.push('/hand/capture')}
              />
              <Button
                label={rereading ? 'Reading' : 'Read again'}
                variant="ghost"
                style={styles.photoAction}
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
          {/* Says *why* the target moved, so an eighteen-tile hand does not
              look like a counting error. */}
          {validation.kongs > 0 ? (
            <Caption tone="muted">
              {validation.kongs === 1 ? 'one kong' : `${validation.kongs} kongs`} declared
            </Caption>
          ) : null}
        </View>

        <Section
          title={
            mode === 'winning' ? 'Tap the winning tile'
            : mode === 'melds' ? 'Mark what you declared'
            : 'The hand'
          }
          first
        >
          <HandRow
            tiles={tiles}
            declared={declaredSet}
            concealed={concealedSet}
            selectedTile={winningIndex}
            mode={mode}
            onTilePress={handleTilePress}
            onReorder={reorderTile}
          />

          <View style={styles.handActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a tile"
              onPress={() => setPicker(-1)}
              style={({ pressed }) => [styles.addTile, pressed && styles.pressed]}
            >
              <PlusIcon size={20} color={colors.inkFaint} />
            </Pressable>
            <Button
              label={mode === 'melds' ? 'Done' : 'Declared melds'}
              variant="ghost"
              onPress={() => {
                setMeldStart(null);
                setMode(mode === 'melds' ? 'edit' : 'melds');
              }}
            />
          </View>

          <Caption tone="faint" style={styles.hint}>
            {mode === 'melds'
              ? meldStart === null
                ? 'Tap the first tile of a meld you set down. Tap a marked meld again to change it — a kong goes to concealed, anything else clears.'
                : 'Now tap the last tile of that meld.'
              : 'Tap a tile to correct it, or hold and drag to move it. Everything stays in hand unless you mark it declared.'}
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
                onPress={() => setPicker(-1)}
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
          picker !== null && picker >= 0
            ? () => {
                removeTileAt(picker);
                setPicker(null);
              }
            : undefined
        }
        alternatives={activeDetection?.alternatives}
        current={picker !== null && picker >= 0 ? (tiles[picker] ?? null) : null}
        title={picker !== null && picker < 0 ? 'Add a tile' : 'Correct this tile'}
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
  photoHint: { marginTop: space.sm, paddingHorizontal: space.xs },
  photoActions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  photoAction: { flex: 1 },
  addPhoto: { marginTop: space.md },
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
