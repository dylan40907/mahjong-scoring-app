import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  PageHeader,
  Body,
  Button,
  Caption,
  CaptionStrong,
  Screen,
  Section,
  TileFace,
  TileScanner,
} from '@/design/components';
import { AlertIcon, CropIcon, FlowerIcon, KongIcon, MeldIcon, PlusIcon, TrophyIcon } from '@/design/icons';
import { colors, radius, space, tileSize } from '@/design/tokens';
import { TilePicker } from '@/components/TilePicker';
import { HandBoundary } from '@/components/HandBoundary';
import { HandRow, type HandRowMode } from '@/components/HandRow';
import { withinBoundary } from '@/vision/boundary';
import { detectTiles } from '@/vision/detector';
import { orderDetections } from '@/vision/ordering';
import { findRuleSet } from '@/store/store';
import type { TileCode } from '@/tiles/tileset';
import { TILE_BY_CODE, isBonus } from '@/tiles/tileset';
import {
  appendTile,
  exposedSet,
  removeBonus,
  removeTileAt,
  reorderTile,
  setExposed,
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
        tiles: ordered.groups.flat().map((tile) => tile.code),
        exposed: [],
        detections: inside,
        imageWidth: result.imageWidth,
        imageHeight: result.imageHeight,
      });
    } catch (error) {
      // The tiles already read stay put and are still editable by hand, but a
      // second failure that says nothing is the same trap as the first.
      updateDraft({ readNote: `Reading again did not work.\n\n${String(error)}` });
    } finally {
      setRereading(false);
    }
  }, [draft.photoUri, draft.boundary]);

  /** The tile the picker is editing. -1 means it is adding a new one. */
  const [picker, setPicker] = useState<number | null>(null);

  const validation = useMemo(
    () =>
      validateDraft(draft, handSize, {
        allowSevenPairs: rules?.allowSevenPairs,
        allowThirteenOrphans: rules?.allowThirteenOrphans,
      }),
    [draft, handSize, rules?.allowSevenPairs, rules?.allowThirteenOrphans],
  );

  const tiles = draft.tiles;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- exposed is the only input
  const melded = useMemo(() => exposedSet(draft), [draft.exposed]);

  const winningIndex = useMemo(
    () => (draft.winningTile ? tiles.indexOf(draft.winningTile) : null),
    [tiles, draft.winningTile],
  );

  const handleTilePress = (index: number) => {
    if (mode === 'winning') {
      updateDraft({ winningTile: tiles[index] });
      setMode('edit');
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
    <Screen padded={false} insetBottom={false} header={<PageHeader title="Check the Tiles" />}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/*
          * Why the photograph could not be read, when it could not be.
          *
          * This screen is where the answer has to appear, because the capture
          * screen replaces itself the moment it finishes and anything it says
          * is drawn for no frames. Without it the failure is a photograph with
          * an empty grid under it, which reads as the app not having tried.
          *
          * Tappable to dismiss rather than automatic, because the diagnostics
          * it can carry are the only evidence available about a device we
          * cannot attach a debugger to.
          */}
        {draft.readNote ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss this message"
            onPress={() => updateDraft({ readNote: null })}
            style={styles.readNote}
          >
            <AlertIcon size={16} color={colors.brass} />
            <Caption tone="muted" style={styles.readNoteText}>
              {draft.readNote}
            </Caption>
          </Pressable>
        ) : null}
        {!draft.photoUri ? (
          <Button
            label="Add a photo"
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
            <View style={styles.photoHintRow}>
              <CropIcon size={15} color={colors.inkFaint} />
              <Caption tone="faint" style={styles.photoHint}>
                Drag a corner in to leave tiles out
              </Caption>
            </View>
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
          {/*
            * A complete hand states its size; an incomplete one states its
            * target. Kongs are counted rather than declared, so eighteen tiles
            * is an answer here rather than a counting error - but only once
            * the tiles actually make a kong, which is what `complete` knows.
            */}
          <CaptionStrong tone={validation.complete ? 'muted' : 'loss'} numeric>
            {validation.complete
              ? `${validation.tileCount} tiles`
              : `${validation.tileCount} of ${validation.nominal} tiles`}
          </CaptionStrong>
          {/*
            * Four tiles and a count, rather than the word.
            *
            * "Kong" is the one piece of jargon here nobody can avoid - every
            * table borrows some version of it - but the drawing says what it
            * is without needing the borrowed word to have landed.
            */}
          {validation.kongs > 0 ? (
            <View style={styles.kongNote}>
              <KongIcon size={20} color={colors.inkMuted} />
              <Caption tone="muted" numeric>
                ×{validation.kongs}
              </Caption>
            </View>
          ) : null}
        </View>

        <Section
          title={
            mode === 'winning' ? 'Tap the winning tile'
            : mode === 'exposed' ? 'Revealed'
            : 'The hand'
          }
          icon={
            mode === 'winning' ? <TrophyIcon size={15} color={colors.brass} />
            : mode === 'exposed' ? <MeldIcon size={15} color={colors.melded} />
            : <MeldIcon size={15} color={colors.inkFaint} />
          }
          first
        >
          <HandRow
            tiles={tiles}
            exposed={melded}
            selectedTile={winningIndex}
            mode={mode}
            onTilePress={handleTilePress}
            onReorder={reorderTile}
            onPaint={setExposed}
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
            {/*
              * "Revealed" rather than "melded" or "exposed".
              *
              * Both of those are translations somebody invented for a thing
              * the player did physically, and neither is what anyone says at
              * a table. What actually happened is that everyone got to see the
              * tiles, which is plain and survives being translated onward.
              */}
            <Button
              label={mode === 'exposed' ? 'Done' : 'Revealed'}
              icon={
                <MeldIcon
                  size={16}
                  color={mode === 'exposed' ? colors.melded : colors.inkMuted}
                />
              }
              onPress={() => setMode(mode === 'exposed' ? 'edit' : 'exposed')}
            />
          </View>

          <Caption tone="faint" style={styles.hint}>
            {mode === 'exposed'
              ? 'Drag across the tiles everyone saw. Drag again to clear.'
              : 'Tap to fix · hold to move'}
          </Caption>
        </Section>

        <Section title="Winning tile" icon={<TrophyIcon size={15} color={colors.inkFaint} />}>
          <View style={styles.winning}>
            {/*
              * The tile itself, at a size you can read, with its name beside
              * it rather than instead of it. The name is the part that does
              * not survive translation, so it is the part that gets to be
              * secondary.
              */}
            {draft.winningTile ? (
              <>
                <TileFace code={draft.winningTile} width={tileSize.md} />
                <Caption tone="faint" style={styles.winningLabel}>
                  {TILE_BY_CODE[draft.winningTile].label}
                </Caption>
              </>
            ) : (
              <Body tone="loss" style={styles.winningLabel}>
                Not chosen
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
          <Section
            title="Flowers"
            icon={<FlowerIcon size={15} color={colors.inkFaint} />}
            note={draft.bonus.length === 0 ? 'None' : undefined}
          >
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
          label="Tally It Up"
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
  photoHintRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    marginTop: space.md,
    paddingHorizontal: space.xs,
  },
  photoHint: { flex: 1 },
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
  kongNote: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
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
  readNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    marginHorizontal: space.xl,
    marginBottom: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  readNoteText: { flex: 1 },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    // Its own gap above the tab bar. `Screen` used to pad the container, which
    // is what clipped the scroll view above it; the action bar keeps the part
    // of that padding it actually wanted.
    paddingBottom: space.md,
    /*
     * No rule and no fill. A hairline with an opaque band under it read as the
     * page being cut off rather than as an action bar, and once the ground
     * gained a wash the flat `ground` fill became a visible patch sitting on
     * top of it. The button is a brass slab; it does not need a box drawn
     * round it to be found.
     */
  },
});
