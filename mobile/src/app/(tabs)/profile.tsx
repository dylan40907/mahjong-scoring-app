import React, { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import {
  Body,
  BodyStrong,
  Button,
  Caption,
  CaptionStrong,
  Divider,
  Panel,
  Row,
  Screen,
  Section,
  TextField,
  TileFace,
  Title,
} from '@/design/components';
import { PlayersIcon, SparkIcon, TrophyIcon } from '@/design/icons';
import { colors, space, tileSize } from '@/design/tokens';
import { findRuleSet, useAppState } from '@/store/store';
import {
  deleteAccount,
  setDisplayName,
  signInWithEmail,
  signOut,
  upgradeWithEmail,
  useAccount,
} from '@/store/account';
import { syncNow } from '@/store/sync/engine';
import { isCloudConfigured } from '@/lib/supabase';
import type { TileCode } from '@/tiles/tileset';
import type { HandRecord, Session } from '@/store/types';
import { relativeDate } from '@/lib/format';

/**
 * The profile.
 *
 * It exists from first launch and for everybody, because everybody has an
 * account from first launch - an anonymous one until they choose otherwise.
 * There is nothing to sign up for and nothing gated behind having done so.
 *
 * The name earns its place immediately: it fills seat one of every new
 * session, which is the one piece of setup starting a game could never skip.
 */
export default function ProfileScreen() {
  const sessions = useAppState(useCallback((state) => state.sessions, []));
  const account = useAccount(useCallback((a) => a, []));
  const [draftName, setDraftName] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const best = useMemo(() => bestHand(sessions), [sessions]);
  const handsScored = sessions.reduce((sum, session) => sum + session.hands.length, 0);

  const commitName = () => {
    if (draftName !== null) void setDisplayName(draftName);
    setDraftName(null);
  };

  /**
   * One form for both, because from here they are the same action.
   *
   * An anonymous account is upgraded in place - `updateUser` attaches the
   * credentials to the *same* user id, so every session already stored against
   * it stays put. Only if that fails because the address is already taken does
   * this become a sign-in, which is the case where the games on this device
   * belong to somebody who already has an account elsewhere.
   */
  const connect = async () => {
    setBusy(true);
    setProblem(null);
    const upgraded = await upgradeWithEmail(email, password);
    if (upgraded) {
      const signedIn = await signInWithEmail(email, password);
      if (signedIn) {
        setProblem(signedIn);
        setBusy(false);
        return;
      }
    }
    setPassword('');
    await syncNow();
    setBusy(false);
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete your account?',
      'Your account and everything stored with it are removed for good. Games on this device stay where they are.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteAccount().then((error) => setProblem(error));
          },
        },
      ],
    );
  };

  return (
    <Screen scroll>
      <View style={styles.head}>
        <Title>{account.displayName || 'Your table'}</Title>
        <Caption tone="faint">
          {account.status === 'identified'
            ? (account.email ?? 'Signed in')
            : account.status === 'anonymous'
              ? 'On this device only'
              : 'Offline'}
        </Caption>
      </View>

      <Section title="Your name" icon={<PlayersIcon size={15} color={colors.inkFaint} />} first>
        <TextField
          value={draftName ?? account.displayName ?? ''}
          onChangeText={setDraftName}
          onBlur={commitName}
          onSubmitEditing={commitName}
          placeholder="What people call you"
          maxLength={18}
        />
        <Caption tone="faint" style={styles.note}>
          Fills your seat when you start a session. Hold a seat to change it there.
        </Caption>
      </Section>

      {/*
        * Highest score for now, which is the obvious pick and a bit boring:
        * for anyone who has ever had a limit hand it is that hand forever.
        * Rarity - how uncommon a hand's best pattern is across this player's
        * own history - makes the better story and is the intended default once
        * there is enough history to measure it against.
        */}
      <Section title="Best hand" icon={<TrophyIcon size={15} color={colors.brass} />}>
        {best ? (
          <Panel style={styles.best}>
            <View style={styles.bestTiles}>
              {best.tiles.slice(0, 9).map((code, index) => (
                <TileFace key={`${code}-${index}`} code={code} width={tileSize.sm} />
              ))}
            </View>
            <View style={styles.bestLine}>
              <BodyStrong tone="accent" numeric>
                {best.record.summary.total} {best.record.summary.unit}
              </BodyStrong>
              <Caption tone="faint">{relativeDate(best.record.createdAt)}</Caption>
            </View>
            {best.record.summary.topPatterns.length > 0 ? (
              <Caption tone="muted">{best.record.summary.topPatterns.join(' · ')}</Caption>
            ) : null}
            <Caption tone="faint">{findRuleSet(best.ruleSetId)?.name ?? ''}</Caption>
          </Panel>
        ) : (
          <Panel style={styles.empty}>
            <SparkIcon size={24} color={colors.inkFaint} />
            <Caption tone="faint">Score a hand and it will show up here.</Caption>
          </Panel>
        )}
      </Section>

      <Section title="All time">
        <Panel flush>
          <Row title="Hands scored" value={String(handsScored)} />
          <Divider inset={space.lg} />
          <Row title="Sessions played" value={String(sessions.length)} />
        </Panel>
      </Section>

      <Section title="Account">
        {account.status === 'identified' ? (
          <>
            <Panel flush>
              <Row title="Signed in as" value={account.email ?? '—'} />
            </Panel>
            <View style={styles.accountActions}>
              <Button label="Sign out" block onPress={() => void signOut()} />
              {/* Required in the app by both stores, not merely polite. */}
              <Button label="Delete account" variant="danger" block onPress={confirmDelete} />
            </View>
          </>
        ) : !isCloudConfigured() ? (
          <Panel>
            <Body tone="muted">
              This build has no account server, so everything stays on this device.
            </Body>
          </Panel>
        ) : (
          <Panel style={styles.upgrade}>
            <Body tone="muted">
              Your games are on this device. Add an email to reach them from another one —
              nothing you have already scored is lost.
            </Body>
            <TextField
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              keyboardType="email-address"
            />
            <TextField
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              secureTextEntry
            />
            <Button
              label="Save my games"
              variant="primary"
              block
              loading={busy}
              disabled={busy || email.trim().length < 3 || password.length < 6}
              onPress={() => void connect()}
            />
            {problem ? <CaptionStrong tone="loss">{problem}</CaptionStrong> : null}
          </Panel>
        )}
      </Section>
    </Screen>
  );
}

interface BestHand {
  readonly record: HandRecord;
  readonly ruleSetId: string;
  readonly tiles: TileCode[];
}

/** The highest-scoring hand across every session, with its tiles. */
function bestHand(sessions: readonly Session[]): BestHand | null {
  let best: BestHand | null = null;
  for (const session of sessions) {
    for (const record of session.hands) {
      if (best && record.summary.total <= best.record.summary.total) continue;
      best = {
        record,
        ruleSetId: session.ruleSetId,
        tiles: [...(record.hand.exposed ?? []), ...record.hand.concealed],
      };
    }
  }
  return best;
}

const styles = StyleSheet.create({
  head: { paddingTop: space.md, paddingBottom: space.xs, gap: 2 },
  note: { marginTop: space.sm, paddingHorizontal: space.xs },
  best: { gap: space.sm },
  bestTiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  bestLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  upgrade: { gap: space.md },
  accountActions: { gap: space.sm, marginTop: space.md },
});
