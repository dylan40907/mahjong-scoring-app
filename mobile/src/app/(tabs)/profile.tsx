import React, { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useRouter } from 'expo-router';
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
import { AwayIcon, FriendsIcon, PlayersIcon, SparkIcon, TrophyIcon } from '@/design/icons';
import { colors, radius, space, tileSize } from '@/design/tokens';
import { findRuleSet, useAppState } from '@/store/store';
import { bestHandFor, playedGames, playerStats } from '@/store/stats';
import { incomingRequests, useFriends } from '@/store/friends';
import {
  deleteAccount,
  isAppleSignInAvailable,
  setDisplayName,
  setHandle,
  signInWithApple,
  signInWithEmail,
  signInWithGoogle,
  signOut,
  upgradeWithEmail,
  useAccount,
} from '@/store/account';
import { syncNow } from '@/store/sync/engine';
import { isCloudConfigured } from '@/lib/supabase';
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
  const router = useRouter();
  const sessions = useAppState(useCallback((state) => state.sessions, []));
  const awayGames = useAppState(useCallback((state) => state.awayGames, []));
  const account = useAccount(useCallback((a) => a, []));
  const friends = useFriends(useCallback((state) => state.friends, []));
  const [draftName, setDraftName] = useState<string | null>(null);
  const [draftHandle, setDraftHandle] = useState<string | null>(null);
  const [handleProblem, setHandleProblem] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const me = useMemo(
    () => ({ userId: account.userId, displayName: account.displayName }),
    [account.userId, account.displayName],
  );
  // Every table this person sat at, whoever was holding the phone.
  const games = useMemo(() => playedGames(sessions, awayGames), [sessions, awayGames]);
  const best = useMemo(() => bestHandFor(games, me), [games, me]);
  const stats = useMemo(() => playerStats(games, me), [games, me]);
  const waiting = incomingRequests(friends).length;

  const commitName = () => {
    if (draftName !== null) void setDisplayName(draftName);
    setDraftName(null);
  };

  /**
   * The name friends look you up by.
   *
   * Separate from the display name because they answer different questions.
   * The display name is what goes on a seat, changes whenever you like, and
   * two people may share one. The handle is unique, is typed by somebody else
   * to find you, and is the only thing this app will look anybody up by - an
   * email address is a fact about a person it has no business being a
   * directory of.
   */
  const commitHandle = () => {
    const wanted = draftHandle;
    setDraftHandle(null);
    if (wanted === null || wanted.trim().toLowerCase() === (account.handle ?? '')) return;
    void setHandle(wanted).then(setHandleProblem);
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

  const withGoogle = async () => {
    setBusy(true);
    setProblem(null);
    const failure = await signInWithGoogle();
    if (failure) setProblem(failure);
    else await syncNow();
    setBusy(false);
  };

  const withApple = async () => {
    setBusy(true);
    setProblem(null);
    const failure = await signInWithApple();
    if (failure) setProblem(failure);
    else await syncNow();
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

      {isCloudConfigured() ? (
        <Section title="Friends" icon={<FriendsIcon size={15} color={colors.inkFaint} />}>
          <Panel flush>
            <Row
              title="Your friends"
              subtitle="Put them in a game and it lands in their history too"
              value={waiting > 0 ? `${waiting} waiting` : undefined}
              onPress={() => router.push('/friends')}
            />
          </Panel>
          <View style={styles.handle}>
            <TextField
              label="How people find you"
              value={draftHandle ?? account.handle ?? ''}
              onChangeText={(text) => setDraftHandle(text.toLowerCase())}
              onBlur={commitHandle}
              onSubmitEditing={commitHandle}
              placeholder="a short name, e.g. wei_88"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
            />
            {handleProblem ? (
              <CaptionStrong tone="loss">{handleProblem}</CaptionStrong>
            ) : (
              <Caption tone="faint">
                Letters, numbers and underscores. Yours alone, and the only thing anyone can look
                you up by.
              </Caption>
            )}
          </View>
        </Section>
      ) : null}

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
            <Caption tone="faint" center>
              {stats.unidentified && stats.handsPlayed > 0
                ? 'None of these games say which player you were. Set your name above, or take a seat in one from its Who’s here list.'
                : 'Win a hand and it will show up here.'}
            </Caption>
          </Panel>
        )}
      </Section>

      <Section title="All time">
        <Panel flush>
          <Row title="Hands you won" value={String(stats.handsWon)} />
          <Divider inset={space.lg} />
          <Row title="Hands played" value={String(stats.handsPlayed)} />
          <Divider inset={space.lg} />
          <Row title="Sessions" value={String(stats.sessions)} />
          {stats.awaySessions > 0 ? (
            <>
              <Divider inset={space.lg} />
              <Row
                title="Scored by a friend"
                subtitle="Games you were seated in on somebody else’s phone"
                leading={<AwayIcon size={18} color={colors.inkFaint} />}
                value={String(stats.awaySessions)}
              />
            </>
          ) : null}
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
            {/*
              * Apple first, and drawn by Apple.
              *
              * Guideline 4.8 requires this button wherever a third-party
              * sign-in is offered, and its own guidelines govern the shape,
              * the wording and the corner radius - so this is their component
              * rather than ours. It is the one place in the app that does not
              * use the house button, and matching the height of the one below
              * is what keeps the two reading as equal choices, which is also
              * something the guideline asks for.
              */}
            {isAppleSignInAvailable() ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                cornerRadius={radius.md}
                style={styles.appleButton}
                onPress={() => void withApple()}
              />
            ) : null}
            <Button
              label="Continue with Google"
              variant="primary"
              block
              disabled={busy}
              onPress={() => void withGoogle()}
            />
            <View style={styles.or}>
              <View style={styles.orLine} />
              <Caption tone="faint">or</Caption>
              <View style={styles.orLine} />
            </View>
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

const styles = StyleSheet.create({
  head: { paddingTop: space.md, paddingBottom: space.xs, gap: 2 },
  note: { marginTop: space.sm, paddingHorizontal: space.xs },
  best: { gap: space.sm },
  bestTiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  bestLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  upgrade: { gap: space.md },
  or: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  orLine: { flex: 1, height: 1, backgroundColor: colors.line },
  accountActions: { gap: space.sm, marginTop: space.md },
  handle: { marginTop: space.md, gap: space.sm },
  /** 44 is Apple's minimum for their button, and the height of ours. */
  appleButton: { height: 44, width: '100%' },
});
