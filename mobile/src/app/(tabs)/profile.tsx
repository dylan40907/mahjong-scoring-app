import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, View } from 'react-native';
import {
  Body,
  BodyStrong,
  Button,
  Caption,
  CaptionStrong,
  Divider,
  Overline,
  Panel,
  Row,
  Screen,
  Section,
  TextField,
  Title,
} from '@/design/components';
import {
  AppleMark,
  AwayIcon,
  CheckIcon,
  EditIcon,
  GoogleMark,
  PersonIcon,
  SparkIcon,
  TrophyIcon,
} from '@/design/icons';
import { colors, radius, space } from '@/design/tokens';
import { BestHandTiles } from '@/components/BestHandTiles';
import { findRuleSet, useAppState } from '@/store/store';
import { bestHandFor, handGroups, playedGames, playerStats } from '@/store/stats';
import {
  deleteAccount,
  isAppleSignInAvailable,
  publishStats,
  setDisplayName,
  setHandle,
  setPrivate,
  signInWithApple,
  signInWithEmail,
  signInWithGoogle,
  signOut,
  upgradeWithEmail,
  useAccount,
  type Account,
} from '@/store/account';
import { syncNow } from '@/store/sync/engine';
import { isCloudConfigured } from '@/lib/supabase';
import { emailTaken, signInProblem } from '@/lib/authErrors';
import { relativeDate } from '@/lib/format';

/**
 * You.
 *
 * Two entirely different screens sharing a tab, and which one you get is the
 * whole design. Signed out, this is the account screen and nothing else -
 * there is no name to set, no username to be found by, no best hand and no
 * totals, because none of those mean anything without somewhere to keep them.
 * Showing them anyway, greyed or half-working, would be four dead controls
 * around the one live one.
 *
 * That is a gate on *account* features and not on the app. Scoring, sessions,
 * rulesets and the whole camera path work untouched without an account, which
 * is both the point and what Apple's guideline 5.1.1(v) requires: registration
 * may only be demanded for things that genuinely need an account, and keeping
 * score does not.
 *
 * Signed in, the top of the screen is the two names - the username people type
 * to find you, and the name that goes on a seat - because those are the two
 * things somebody comes here to change.
 */
export default function ProfileScreen() {
  const sessions = useAppState(useCallback((state) => state.sessions, []));
  const awayGames = useAppState(useCallback((state) => state.awayGames, []));
  const account = useAccount(useCallback((a) => a, []));

  const signedIn = account.status === 'identified';

  const me = useMemo(
    () => ({ userId: account.userId, displayName: account.displayName }),
    [account.userId, account.displayName],
  );
  const games = useMemo(() => playedGames(sessions, awayGames), [sessions, awayGames]);
  const best = useMemo(() => bestHandFor(games, me), [games, me]);
  const stats = useMemo(() => playerStats(games, me), [games, me]);
  const bestGroups = useMemo(
    () => (best ? handGroups(best.record.hand, findRuleSet(best.ruleSetId)) : null),
    [best],
  );
  const bestTiles = useMemo(
    () => (best ? [...best.tiles, ...(best.record.hand.bonus ?? [])] : []),
    [best],
  );

  /*
   * Push the numbers a profile shows whenever they change.
   *
   * They are a cache of something already on this screen, so this is quiet and
   * allowed to fail; a profile a little out of date is the cost, and nothing
   * is lost. Only for a real account - an anonymous one has no profile anybody
   * can look at.
   */
  useEffect(() => {
    if (!signedIn) return;
    void publishStats({
      handsWon: stats.handsWon,
      handsPlayed: stats.handsPlayed,
      sessions: stats.sessions,
      net: stats.net,
      best: best
        ? {
            total: best.record.summary.total,
            unit: best.record.summary.unit,
            patterns: best.record.summary.topPatterns,
            // All of it. This used to be cut at eighteen, which is short of a
            // Taiwanese hand with a kong and its flowers.
            tiles: bestTiles,
            groups: bestGroups,
            ruleSetId: best.ruleSetId,
            at: best.record.createdAt,
          }
        : null,
    });
  }, [signedIn, stats, best, bestTiles, bestGroups]);

  if (!isCloudConfigured()) {
    return (
      <Screen scroll motif="rings">
        <Section title="Account" icon={<PersonIcon size={15} color={colors.inkFaint} />} first>
          <Panel>
            <Body tone="muted">
              This build has no account server, so everything stays on this device.
            </Body>
          </Panel>
        </Section>
      </Screen>
    );
  }

  if (!signedIn) return <SignedOut />;

  return (
    <Screen scroll motif="rings">
      <Identity account={account} />

      <Section title="Best hand" icon={<TrophyIcon size={15} color={colors.brass} />}>
        {best ? (
          <Panel style={styles.best}>
            <BestHandTiles groups={bestGroups} tiles={bestTiles} />
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
                ? 'None of these games say which player you were. Open one and tap your seat under Who’s here.'
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
                leading={<AwayIcon size={18} color={colors.inkFaint} />}
                value={String(stats.awaySessions)}
              />
            </>
          ) : null}
        </Panel>
      </Section>

      <AccountActions account={account} />
    </Screen>
  );
}

/**
 * The two names, and the one that other people type.
 *
 * The username sits at the top with the display name under it because that is
 * the order somebody reads a profile in: who this is, then what to call them.
 * Editing is behind a pencil rather than an always-open field - a username is
 * changed once a year and a text box invites changing it by accident.
 */
function Identity({ account }: { account: Account }) {
  const [editingHandle, setEditingHandle] = useState(false);
  const [draftHandle, setDraftHandle] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [draftName, setDraftName] = useState<string | null>(null);

  const commitHandle = () => {
    const wanted = draftHandle.trim().toLowerCase();
    setProblem(null);
    if (!wanted || wanted === account.handle) {
      setEditingHandle(false);
      return;
    }
    void setHandle(wanted).then((failure) => {
      setProblem(failure);
      if (!failure) setEditingHandle(false);
    });
  };

  const commitName = () => {
    if (draftName !== null) void setDisplayName(draftName);
    setDraftName(null);
  };

  return (
    <View style={styles.identity}>
      {editingHandle ? (
        <View style={styles.handleEdit}>
          <TextField
            label="Username"
            value={draftHandle}
            onChangeText={(text) => setDraftHandle(text.toLowerCase())}
            onSubmitEditing={commitHandle}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            maxLength={20}
          />
          <View style={styles.handleActions}>
            <Button label="Save" variant="primary" onPress={commitHandle} />
            <Button label="Cancel" onPress={() => setEditingHandle(false)} />
          </View>
          {problem ? (
            <CaptionStrong tone="loss">{problem}</CaptionStrong>
          ) : (
            <Caption tone="faint">
              Three to twenty characters: letters, numbers and underscores.
            </Caption>
          )}
        </View>
      ) : (
        <View style={styles.handleRow}>
          <Title style={styles.handle}>{account.handle ?? 'Choose a username'}</Title>
          <Button
            label="Change username"
            icon={<EditIcon size={15} color={colors.inkMuted} />}
            onPress={() => {
              setDraftHandle(account.handle ?? '');
              setProblem(null);
              setEditingHandle(true);
            }}
          />
        </View>
      )}

      <View style={styles.nameField}>
        <TextField
          label="Display name"
          value={draftName ?? account.displayName ?? ''}
          onChangeText={setDraftName}
          onBlur={commitName}
          onSubmitEditing={commitName}
          placeholder="What people call you"
          maxLength={18}
        />
        <Caption tone="faint">
          Shown on your profile, and filled into your seat when you start a session.
        </Caption>
      </View>
    </View>
  );
}

/**
 * Public or private, as a choice between two described options.
 *
 * It used to be a checkbox labelled "Private profile", which read backwards
 * both ways: unticked, the label named the mode you were not in while the hint
 * under it described the one you were; ticked, the same label sat over a
 * different paragraph. Two named options, each carrying its own description,
 * cannot say one thing and mean the other.
 *
 * It is also no longer a section of its own. It is set once, and a heading
 * with a paragraph under it gave it the same weight as the stats.
 */
const VISIBILITY = [
  {
    isPrivate: false,
    title: 'Public',
    body: 'Anyone can find you by searching your name or username, and send you a friend request.',
  },
  {
    isPrivate: true,
    title: 'Private',
    body: 'You do not show up in search, and nobody can send you a friend request. You can still send them, and anyone who accepts can see your profile.',
  },
] as const;

function VisibilityPicker({
  visible,
  isPrivate,
  onClose,
}: {
  visible: boolean;
  isPrivate: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.popupRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.popup}>
          <BodyStrong>Profile visibility</BodyStrong>
          {VISIBILITY.map((option) => {
            const selected = option.isPrivate === isPrivate;
            return (
              <Pressable
                key={option.title}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => {
                  if (!selected) void setPrivate(option.isPrivate);
                  onClose();
                }}
                style={({ pressed }) => [
                  styles.option,
                  selected && styles.optionOn,
                  pressed && styles.optionPressed,
                ]}
              >
                <View style={styles.optionHead}>
                  <BodyStrong tone={selected ? 'accent' : 'default'}>{option.title}</BodyStrong>
                  {selected ? <CheckIcon size={16} color={colors.brass} /> : null}
                </View>
                <Caption tone="muted">{option.body}</Caption>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

function AccountActions({ account }: { account: Account }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

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
    <Section title="Account">
      <Panel flush>
        <Row title="Signed in as" value={account.email ?? '—'} />
        <Divider inset={space.lg} />
        <Row
          title="Profile visibility"
          value={account.isPrivate ? 'Private' : 'Public'}
          onPress={() => setPicking(true)}
        />
      </Panel>
      <VisibilityPicker
        visible={picking}
        isPrivate={account.isPrivate}
        onClose={() => setPicking(false)}
      />
      <View style={styles.accountActions}>
        <Button label="Sign out" block onPress={() => void signOut()} />
        {/* Required in the app by both stores, not merely polite. */}
        <Button label="Delete account" variant="danger" block onPress={confirmDelete} />
      </View>
      {problem ? <CaptionStrong tone="loss">{problem}</CaptionStrong> : null}
    </Section>
  );
}

/**
 * What the tab is before there is an account.
 *
 * Two ways in on one screen: making an account, and signing in to one made on
 * another phone. They were one button, "Create account", which quietly signed
 * you in if the address was already taken - so somebody coming back had to
 * press a button that said the opposite of what they wanted, and a wrong
 * password came back as an error about logging in from a form about signing
 * up. The providers above the form serve both already; only the email half
 * needs to know which one you meant.
 *
 * Signing in drops the pitch. Somebody returning already knows what an
 * account is for.
 */
function SignedOut() {
  const [mode, setMode] = useState<'create' | 'signin'>('create');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  // Separate from `problem`, which is drawn in the loss tone. "Check your
  // email" is an instruction, not a failure.
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signingIn = mode === 'signin';

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    const failure = await action();
    if (failure) setProblem(failure);
    else await syncNow();
    setBusy(false);
  };

  const switchMode = () => {
    setMode(signingIn ? 'create' : 'signin');
    setProblem(null);
    setNotice(null);
    setPassword('');
  };

  /*
   * The anonymous account is upgraded in place, keeping every game already on
   * this device. If the address already has an account, the same password is
   * tried as a sign-in - that is nearly always somebody who meant the other
   * half of the form - and only if that fails too are they sent there.
   */
  const create = () =>
    run(async () => {
      const address = email.trim();
      const failure = await upgradeWithEmail(address, password);
      if (!failure) {
        setPassword('');
        /*
         * Signing up is not finished here, and the screen used to imply it
         * was. The project requires a confirmed address, so `updateUser`
         * attaches nothing until a link is opened - and this returned null,
         * which the caller reads as success and shows nothing at all.
         * Somebody typed a password, watched the form do nothing, and still
         * had an anonymous account.
         *
         * The provider buttons say none of this, correctly: Google and Apple
         * have already established who the address belongs to.
         */
        setNotice(`Almost there. Open the link we sent to ${address} to finish.`);
        return null;
      }
      if (!emailTaken(failure)) return failure;
      const refused = await signInWithEmail(address, password);
      if (!refused) return null;
      setPassword('');
      setMode('signin');
      return 'That email already has an account. Enter its password to sign in.';
    });

  const signIn = () =>
    run(async () => {
      const failure = await signInWithEmail(email.trim(), password);
      if (!failure) return null;
      setPassword('');
      return signInProblem(failure);
    });

  return (
    <Screen scroll motif="rings">
      <View style={styles.pitch}>
        <Title>{signingIn ? 'Welcome back' : 'Make an account'}</Title>
        <Body tone="muted">
          {signingIn
            ? 'Sign in and your games and friends are right where you left them.'
            : 'It is free, and scoring keeps working without one.'}
        </Body>
      </View>

      {signingIn ? null : (
        <Panel style={styles.perks}>
          {[
            ['Your games follow you', 'Change phones and every night you have scored is still there.'],
            ['Play with friends', 'Add the people at your table and they get the same scores you do.'],
            ['A record worth showing', 'Your best hand and your running totals, on a page of your own.'],
          ].map(([title, body]) => (
            <View key={title} style={styles.perk}>
              <BodyStrong>{title}</BodyStrong>
              <Caption tone="muted">{body}</Caption>
            </View>
          ))}
        </Panel>
      )}

      <Section title="Continue with">
        <View style={styles.providers}>
          {isAppleSignInAvailable() ? (
            <Button
              label="Continue with Apple"
              variant="apple"
              icon={<AppleMark size={18} />}
              block
              disabled={busy}
              onPress={() => void run(signInWithApple)}
            />
          ) : null}
          <Button
            label="Continue with Google"
            variant="provider"
            icon={<GoogleMark size={18} />}
            block
            disabled={busy}
            onPress={() => void run(signInWithGoogle)}
          />
        </View>

        <View style={styles.or}>
          <View style={styles.orLine} />
          <Overline>or</Overline>
          <View style={styles.orLine} />
        </View>

        <Panel style={styles.emailForm}>
          <TextField
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            keyboardType="email-address"
            autoCorrect={false}
          />
          <TextField
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
          />
          {problem ? <CaptionStrong tone="loss">{problem}</CaptionStrong> : null}
          {notice ? <CaptionStrong tone="accent">{notice}</CaptionStrong> : null}
          <Button
            label={signingIn ? 'Sign in' : 'Create account'}
            block
            loading={busy}
            disabled={
              busy || email.trim().length < 3 || password.length < (signingIn ? 1 : 6)
            }
            onPress={() => void (signingIn ? signIn() : create())}
          />
          <Pressable
            accessibilityRole="link"
            onPress={switchMode}
            hitSlop={8}
            style={({ pressed }) => [styles.switch, pressed && styles.switchPressed]}
          >
            <Caption tone="muted" center>
              {signingIn ? 'New here? ' : 'Already have an account? '}
              <CaptionStrong tone="accent">
                {signingIn ? 'Create an account' : 'Sign in'}
              </CaptionStrong>
            </Caption>
          </Pressable>
        </Panel>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { paddingTop: space.md, gap: space.lg },
  handleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  handle: { flex: 1 },
  handleEdit: { gap: space.sm },
  handleActions: { flexDirection: 'row', gap: space.sm },
  nameField: { gap: space.sm },
  best: { gap: space.sm },
  bestLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  accountActions: { gap: space.sm, marginTop: space.md },

  popupRoot: { flex: 1, justifyContent: 'center', padding: space.xl },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  popup: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    borderTopColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  option: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.ground,
  },
  optionOn: { borderColor: colors.brass, backgroundColor: colors.brassWash },
  optionPressed: { opacity: 0.7 },
  optionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  pitch: { paddingTop: space.md, paddingBottom: space.lg, gap: space.sm },
  perks: { gap: space.lg },
  perk: { gap: 2 },
  providers: { gap: space.sm },
  emailForm: { gap: space.md },
  switch: { alignSelf: 'center', paddingVertical: space.xs },
  switchPressed: { opacity: 0.6 },
  or: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginVertical: space.lg },
  orLine: { flex: 1, height: 1, backgroundColor: colors.line },
});
