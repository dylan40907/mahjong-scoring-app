import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Body, Button, Caption, Screen, TileScanner, Title } from '@/design/components';
import { CameraIcon, ImageIcon, TileIcon } from '@/design/icons';
import { colors, radius, space } from '@/design/tokens';
import { findRuleSet, useAppState } from '@/store/store';
import { getDraft, updateDraft } from '@/store/draft';
import { orderDetections } from '@/vision/ordering';
import { handBoundary, withinBoundary } from '@/vision/boundary';
import {
  detectTiles,
  isVisionSupported,
  visionUnavailableReason,
  warmUp,
} from '@/vision/detector';

/**
 * Capture.
 *
 * The preview is framed rather than full-bleed, with a guide rule across the
 * middle. A full-screen viewfinder looks more impressive and works worse here:
 * the single biggest thing the user can do for accuracy is lay the hand out
 * straight and fill the frame with it, and a bare camera says nothing about
 * either.
 *
 * Manual entry is offered from the start, not buried as an error path. Some
 * hands are quicker to type than to photograph, and the app should not insist
 * on the model.
 */
export default function CaptureScreen() {
  const router = useRouter();
  const settings = useAppState(useCallback((state) => state.settings, []));
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);

  const [busy, setBusy] = useState(false);
  /** The frame being read, shown frozen in place of the live feed. */
  const [captured, setCaptured] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const draft = getDraft();
  const rules = findRuleSet(draft.ruleSetId);
  const handSize = rules?.handSize ?? 16;

  // Stated up front rather than discovered after a failed attempt: if the
  // models cannot run here, the honest thing is to say so before the user
  // takes a photo expecting them to.
  const unavailable = visionUnavailableReason();

  useEffect(() => {
    if (settings.detectionEnabled) warmUp();
  }, [settings.detectionEnabled]);

  const cameraReady = Platform.OS !== 'web' && permission?.granted;

  const process = useCallback(
    async (uri: string) => {
      updateDraft({ photoUri: uri });
      setCaptured(uri);

      if (!settings.detectionEnabled || !isVisionSupported()) {
        setMessage(null);
        router.replace('/hand/review');
        return;
      }

      setBusy(true);
      setMessage('Reading the tiles…');
      try {
        const result = await detectTiles(uri);
        // Everything outside the hand is dropped before it can become a tile
        // the user has to notice and delete.
        const boundary = handBoundary(result.detections, result.imageWidth, result.imageHeight);
        const inside = withinBoundary(result.detections, boundary);
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
          // Nothing is assumed exposed. Which tiles were melded cannot be read
          // from a photograph - a player who tidies their hand before you take
          // it has erased the spacing the old guess relied on - and guessing
          // wrong changes the score. The player marks them on the review screen.
          meldGroups: [],
          detections: inside,
          boundary,
          imageWidth: result.imageWidth,
          imageHeight: result.imageHeight,
          flagged,
        });
      } catch (error) {
        // Detection failing is not a dead end - it just means the hand gets
        // typed in instead, which the review screen supports either way.
        setMessage(
          error instanceof Error && error.name === 'VisionUnavailableError'
            ? 'Tiles will need to be entered by hand on this device.'
            : 'The tiles could not be read from that photo. Enter them by hand.',
        );
      } finally {
        setBusy(false);
        router.replace('/hand/review');
      }
    },
    [router, settings.confidenceThreshold, settings.detectionEnabled],
  );

  const takePhoto = async () => {
    if (!camera.current) return;
    setBusy(true);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.9, skipProcessing: false });
      if (photo?.uri) await process(photo.uri);
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
      photoUri: null, groups: [[]], detections: [], boundary: null,
      imageWidth: 0, imageHeight: 0, flagged: [],
    });
    setCaptured(null);
    router.replace('/hand/review');
  };

  return (
    <Screen>
      <View style={styles.intro}>
        <Title>Lay the hand out flat</Title>
        <Body tone="muted" style={styles.introBody}>
          Fill the frame with the tiles and keep the row roughly level. Melds can stay separated —
          the app will keep them apart.
        </Body>
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
          <Image source={{ uri: captured }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : cameraReady ? (
          <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />
        ) : (
          <View style={styles.placeholder}>
            <TileIcon size={34} color={colors.inkFaint} />
            <Caption tone="faint" center style={styles.placeholderText}>
              {Platform.OS === 'web'
                ? 'The camera is unavailable in the browser preview.'
                : 'Camera access is needed to photograph a hand.'}
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
            {message ??
              unavailable ??
              `${handSize + 1} tiles including the winning tile · ${rules?.name ?? ''}`}
          </Caption>
        )}
      </View>

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
          <Button label="Allow Camera Access" variant="primary" block onPress={requestPermission} />
        ) : null}

        <Button
          label="Choose a Photo"
          block
          disabled={busy}
          icon={<ImageIcon size={18} color={colors.ink} />}
          onPress={pickPhoto}
        />
        <Button
          label="Enter tiles by hand"
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
  intro: { paddingTop: space.sm, gap: space.sm },
  introBody: { maxWidth: 420 },
  frame: {
    flex: 1,
    marginTop: space.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.well,
    overflow: 'hidden',
    minHeight: 200,
  },
  placeholder: { ...FILL, alignItems: 'center', justifyContent: 'center', gap: space.md },
  placeholderText: { maxWidth: 240 },
  status: { paddingVertical: space.lg, minHeight: 48, justifyContent: 'center' },
  actions: { gap: space.sm },
});
