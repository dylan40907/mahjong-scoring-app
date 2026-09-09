import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import {
  PageHeader,
  Body,
  BodyStrong,
  Button,
  Caption,
  ChoiceGrid,
  Expander,
  Panel,
  Row,
  Screen,
  Stepper,
  TileFace,
  TileScanner,
  type ChoiceItem,
} from '@/design/components';
import {
  CameraIcon,
  DealIcon,
  DiscardIcon,
  DoraIcon,
  FlatRowIcon,
  FramingIcon,
  ImageIcon,
  KongIcon,
  LastOfKindIcon,
  ReadyIcon,
  RiichiStickIcon,
  RobKongIcon,
  SelfDrawIcon,
  SparkIcon,
  TileIcon,
  WallIcon,
} from '@/design/icons';
import { colors, radius, space, tileSize } from '@/design/tokens';
import type { HandContext } from '@/scoring';
import { findRuleSet, useAppState } from '@/store/store';
import { getDraft, updateDraft, useDraft } from '@/store/draft';
import { orderDetections } from '@/vision/ordering';
import { fullFrame } from '@/vision/boundary';
import { CAPTURE_ASPECT } from '@/vision/frame';
import { cropToFrame } from '@/lib/photos';
import {
  detectTiles,
  isVisionSupported,
  visionDiagnostics,
  visionUnavailableReason,
  warmUp,
  VisionUnavailableError,
} from '@/vision/detector';

/**
 * Capture.
 *
 * The preview is framed rather than full-bleed, and the frame is the whole
 * point. A full-screen viewfinder looks more impressive and works worse here:
 * the single biggest thing the user can do for accuracy is lay the hand out
 * straight and fill the frame with it, and a bare camera says nothing about
 * either.
 *
 * The frame is also a contract. The photograph is cropped to it before
 * anything else happens, so what the user framed is what gets read, what gets
 * saved with the hand, and what the review screen shows. It used to be a
 * suggestion - the app photographed the whole sensor and then went looking for
 * the hand inside it - which is why tiles nobody had pointed the camera at
 * kept turning up in the results.
 *
 * Manual entry is offered from the start, not buried as an error path. Some
 * hands are quicker to type than to photograph, and the app should not insist
 * on the model.
 *
 * The circumstances that a photograph cannot show live here too, behind one
 * closed expander. They used to be a screen of their own between the table
 * and the camera, which cost a tap on every hand to display a list that
 * applies to almost none of them.
 */
export default function CaptureScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);

  const [busy, setBusy] = useState(false);
  /** The frame being read, shown frozen in place of the live feed. */
  const [captured, setCaptured] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const draft = useDraft(useCallback((d) => d, []));
  const session = useAppState(
    useCallback((state) => state.sessions.find((s) => s.id === draft.sessionId), [draft.sessionId]),
  );
  const rules = findRuleSet(draft.ruleSetId);
  const family = rules?.family ?? 'taiwanese';
  const winner = session?.players.find((player) => player.id === draft.winnerId);
  const discarder = session?.players.find((player) => player.id === draft.discarderId);
  const flags = draft.context;

  /*
   * Flags go straight into the draft rather than into local state.
   *
   * There is no "next" button on this screen to commit them on - taking the
   * photograph is what moves the flow along, and it can happen at any moment,
   * including while the expander is open.
   */
  const setFlag = useCallback(
    <K extends keyof HandContext>(key: K, value: HandContext[K]) => {
      updateDraft({ context: { ...getDraft().context, [key]: value } });
    },
    [],
  );
  const handSize = rules?.handSize ?? 16;

  // Stated up front rather than discovered after a failed attempt: if the
  // models cannot run here, the honest thing is to say so before the user
  // takes a photo expecting them to.
  const unavailable = visionUnavailableReason();

  useEffect(() => {
    warmUp();
  }, []);

  const cameraReady = Platform.OS !== 'web' && permission?.granted;

  /** One card per situation, filtered to the ones this ruleset can pay for. */
  const situations = useMemo<ChoiceItem[]>(() => {
    const card = (
      key: keyof HandContext,
      label: string,
      icon: (color: string) => React.ReactNode,
    ): ChoiceItem => ({
      key,
      label,
      icon: (color) => icon(color as string),
      selected: !!flags[key],
      onPress: () => setFlag(key, !flags[key] as never),
    });

    const items: ChoiceItem[] = [];
    if (family === 'riichi') {
      items.push(
        card('riichi', 'Riichi', (c) => <RiichiStickIcon size={24} color={c} />),
        card('doubleRiichi', 'Double riichi', (c) => <RiichiStickIcon size={24} color={c} />),
        card('ippatsu', 'Ippatsu', (c) => <SparkIcon size={24} color={c} />),
      );
    }
    items.push(
      card('lastTileFromWall', 'Last tile', (c) => <WallIcon size={24} color={c} />),
      card('lastDiscard', 'Last discard', (c) => <DiscardIcon size={24} color={c} />),
      card('afterKong', 'After a kong', (c) => <KongIcon size={24} color={c} />),
      card('robbingKong', 'Robbed a kong', (c) => <RobKongIcon size={24} color={c} />),
    );
    if (family === 'mcr') {
      items.push(card('lastTileOfKind', 'Last of four', (c) => <LastOfKindIcon size={24} color={c} />));
    }
    if (family === 'taiwanese') {
      items.push(card('readyOnDeal', 'Ready on deal', (c) => <ReadyIcon size={24} color={c} />));
    }
    items.push(
      card('heavenly', 'Won on the deal', (c) => <DealIcon size={24} color={c} />),
      card('earthly', 'First discard', (c) => <DiscardIcon size={24} color={c} />),
    );
    return items;
  }, [flags, family, setFlag]);

  const chosen = situations.filter((item) => item.selected).length + (flags.dora ? 1 : 0);

  const process = useCallback(
    async (uri: string) => {
      updateDraft({ photoUri: uri });
      setCaptured(uri);

      if (!isVisionSupported()) {
        setMessage(null);
        router.replace('/hand/review');
        return;
      }

      setBusy(true);
      setMessage('Reading the tiles…');
      try {
        const result = await detectTiles(uri);
        /*
         * The boundary starts as the whole picture rather than as a guess.
         *
         * Clustering the detections to find the hand was wrong twice over: it
         * failed quietly on the photographs it mattered for - two rows read as
         * two clusters, a stacked wall outnumbering the hand - and it second-
         * guessed a frame the user had already drawn with the camera. Now the
         * frame is the boundary, and shrinking it is something the user does
         * deliberately when something strayed into shot.
         */
        const boundary = fullFrame(result.imageWidth, result.imageHeight);
        const ordered = orderDetections(result.detections);

        updateDraft({
          /*
           * A read that returns nothing is a failure with no error attached,
           * and it is the most likely one: a dark photo, a hand at the far end
           * of the table, a set the models have never seen. Saying so beats an
           * empty grid that looks like the app did not try.
           */
          readNote:
            result.detections.length === 0
              ? 'No tiles were found in that photo. Try again with the hand filling more of the frame, or enter the tiles by hand.'
              : null,
          tiles: ordered.groups.flat().map((tile) => tile.code),
          // Nothing is assumed melded. Which tiles were set down cannot be read
          // from a photograph - a player who tidies their hand before you take
          // it has erased the spacing the old guess relied on - and guessing
          // wrong changes the score. The player paints them on the review screen.
          exposed: [],
          detections: result.detections,
          boundary,
          imageWidth: result.imageWidth,
          imageHeight: result.imageHeight,
        });
      } catch (error) {
        /*
         * Detection failing is not a dead end - the hand gets typed in
         * instead - but it has to be *said*, and it cannot be said here: the
         * `finally` below replaces this screen immediately, so anything set on
         * it is drawn for no frames. It goes onto the draft, which the review
         * screen owns and can show.
         *
         * The diagnostics ride along when the module itself is missing.
         * `visionDiagnostics` exists because each wrong guess about why native
         * inference is absent costs a twenty-minute build, and it is worth
         * nothing if it never reaches a screen.
         */
        /*
         * Three different failures, and they used to produce two messages
         * between them. Anything named `VisionUnavailableError` was reported
         * as "not in this build" - including the case where the module was
         * present and the *models* failed to open, which is a different
         * problem with a different fix and whose actual error text was thrown
         * away. That cost a whole TestFlight cycle: the diagnostics said the
         * native side was fine and the message insisted it was missing.
         *
         * `kind` already knew the difference. Only 'unsupported' is about the
         * build; everything else carries its own reason and has to show it.
         */
        const vision = error instanceof Error && error.name === 'VisionUnavailableError'
          ? (error as VisionUnavailableError)
          : null;
        updateDraft({
          readNote:
            vision?.kind === 'unsupported'
              ? `Tiles cannot be read from photos in this build, so enter them by hand.\n\n${visionDiagnostics()}`
              : `The tiles could not be read from that photo. Enter them by hand.\n\n${
                  vision ? vision.message : String(error)
                }\n\n${visionDiagnostics()}`,
        });
      } finally {
        setBusy(false);
        router.replace('/hand/review');
      }
    },
    [router],
  );

  const takePhoto = async () => {
    if (!camera.current) return;
    setBusy(true);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.9, skipProcessing: false });
      if (!photo?.uri) return;
      // Cropped here rather than anywhere later: this is the only moment the
      // frame the user was looking at is still known.
      const framed = await cropToFrame(photo.uri, photo.width, photo.height);
      await process(framed.uri);
    } catch {
      setMessage('The camera could not take that photo.');
      setBusy(false);
    }
  };

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      await process(result.assets[0].uri);
    }
  };

  const enterManually = () => {
    updateDraft({
      photoUri: null, tiles: [], exposed: [],
      detections: [], boundary: null, imageWidth: 0, imageHeight: 0,
    });
    setCaptured(null);
    router.replace('/hand/review');
  };

  return (
    <Screen header={<PageHeader title="Photograph the Hand" />}>
      {/*
        * Two lines and two drawings, where there used to be a heading and a
        * paragraph. Both rules matter and neither needs a sentence: a frame
        * with a tile outside it says "what is outside is not read" without
        * asking anyone to read English, and the row of tiles says "flat and
        * level" by being flat and level.
        */}
      {/*
        * Who won and how, stated rather than asked.
        *
        * Both were answered a tap ago on the table screen, in the order people
        * say them out loud, so repeating the question here would read as the
        * app not having listened. The seat tile is the same mark the player
        * carries on the table, and the drawing says where the tile came from.
        */}
      {winner ? (
        <Panel style={styles.recap}>
          <TileFace code={winner.seat} width={tileSize.sm} />
          <View style={styles.recapBody}>
            <BodyStrong numberOfLines={1}>{winner.name}</BodyStrong>
            <Caption tone="faint" numberOfLines={1}>
              {flags.selfDrawn ? 'Self-draw' : (discarder?.name ?? 'On a discard')}
            </Caption>
          </View>
          {flags.selfDrawn ? (
            <SelfDrawIcon size={22} color={colors.brass} />
          ) : (
            <DiscardIcon size={22} color={colors.inkMuted} />
          )}
        </Panel>
      ) : null}

      <View style={styles.unusual}>
        <Expander
          title="Anything unusual?"
          note={chosen > 0 ? String(chosen) : undefined}
          icon={<SparkIcon size={16} color={colors.inkFaint} />}
        >
          <ChoiceGrid items={situations} />
          {family === 'riichi' ? (
            <Row
              title="Dora"
              leading={<DoraIcon size={20} color={colors.inkMuted} />}
              trailing={
                <Stepper
                  value={flags.dora ?? 0}
                  min={0}
                  max={12}
                  onChange={(value) => setFlag('dora', value)}
                />
              }
            />
          ) : null}
          {family === 'taiwanese' ? (
            <Row
              title="Discards before the win"
              leading={<DiscardIcon size={20} color={colors.inkMuted} />}
              trailing={
                <Stepper
                  value={flags.discardsBeforeWin ?? 20}
                  min={0}
                  max={40}
                  onChange={(value) => setFlag('discardsBeforeWin', value)}
                />
              }
            />
          ) : null}
        </Expander>
      </View>

      <View style={styles.intro}>
        <View style={styles.rule}>
          <FramingIcon size={22} color={colors.brass} />
          <Body tone="muted" style={styles.ruleText}>
            Only what is in the frame is read
          </Body>
        </View>
        <View style={styles.rule}>
          <FlatRowIcon size={22} color={colors.inkMuted} />
          <Body tone="muted" style={styles.ruleText}>
            Lay the tiles flat and level
          </Body>
        </View>
      </View>

      <View style={styles.frame}>
        {/*
          * Once there is a photograph, that is what the frame shows.
          *
          * A live camera feed carrying on behind a scanning animation says the
          * app is reading whatever the lens is pointed at now, which is not what
          * is happening - it is reading the frame already taken. It was worse
          * for a picture chosen from the library, where the feed showed a scene
          * with no connection to the tiles being read at all.
          */}
        {captured ? (
          /* `contain`, not `cover`: a photograph from the library was never
             cropped to this frame, and showing it filled would crop it on
             screen only - claiming the tiles at the edges were not read when
             they were. */
          <Image source={{ uri: captured }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        ) : cameraReady ? (
          <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />
        ) : (
          <View style={styles.placeholder}>
            <TileIcon size={34} color={colors.inkFaint} />
            <Caption tone="faint" center style={styles.placeholderText}>
              {Platform.OS === 'web'
                ? 'No camera in the browser preview.'
                : 'Camera access needed.'}
            </Caption>
          </View>
        )}
      </View>

      <View style={styles.status}>
        {busy ? (
          /*
           * The scanner replaces the caption rather than sitting beside it: a
           * line of text and a moving graphic saying the same thing is one of
           * them too many, and the graphic says it better.
           */
          <TileScanner label="Reading the tiles…" />
        ) : (
          <Caption tone={message ? 'loss' : unavailable ? 'muted' : 'faint'} center>
            {message ?? unavailable ?? `${rules?.name ?? ''} · ${handSize + 1} tiles`}
          </Caption>
        )}
      </View>

      <View style={styles.spacer} />

      <View style={styles.actions}>
        {cameraReady ? (
          <Button
            label="Take Photo"
            variant="primary"
            block
            loading={busy}
            icon={<CameraIcon size={18} color={colors.onBrass} />}
            onPress={takePhoto}
          />
        ) : Platform.OS !== 'web' && permission && !permission.granted ? (
          <Button label="Allow Camera" variant="primary" block onPress={requestPermission} />
        ) : null}

        <Button
          label="From Gallery"
          block
          disabled={busy}
          icon={<ImageIcon size={18} color={colors.ink} />}
          onPress={pickPhoto}
        />
        <Button
          label="Type the tiles in"
          variant={unavailable ? 'primary' : 'ghost'}
          block
          disabled={busy}
          onPress={enterManually}
        />
      </View>
    </Screen>
  );
}

/** RN 0.86 dropped StyleSheet.absoluteFillObject from its types. */
const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

const styles = StyleSheet.create({
  recap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.md,
  },
  recapBody: { flex: 1, gap: 1 },
  unusual: { marginTop: space.sm },
  intro: { paddingTop: space.lg, gap: space.md },
  rule: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  ruleText: { flex: 1 },
  spacer: { flex: 1 },
  introBody: { maxWidth: 420 },
  /**
   * Shaped, not stretched.
   *
   * The frame is the crop, so it has to be a shape rather than whatever space
   * the screen had left over - otherwise the same hand photographed on a tall
   * phone and a short one would be cropped differently. Two rows of 3:4 tiles
   * is about 3:1, so a frame near that is filled by the hand instead of by the
   * table around it.
   */
  frame: {
    width: '100%',
    aspectRatio: CAPTURE_ASPECT,
    marginTop: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.well,
    overflow: 'hidden',
  },
  placeholder: { ...FILL, alignItems: 'center', justifyContent: 'center', gap: space.md },
  placeholderText: { maxWidth: 240 },
  status: { paddingVertical: space.lg, minHeight: 48, justifyContent: 'center' },
  actions: { gap: space.sm },
});
