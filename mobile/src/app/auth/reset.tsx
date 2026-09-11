import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Body,
  Button,
  Caption,
  CaptionStrong,
  EmptyState,
  PageHeader,
  Panel,
  Screen,
  TextField,
} from '@/design/components';
import { CheckIcon, PersonIcon } from '@/design/icons';
import { colors, space } from '@/design/tokens';
import { openRecoveryLink, setNewPassword, useAccount } from '@/store/account';
import { resetProblem } from '@/lib/authErrors';

/**
 * Where a password-reset email lands: `tiletally://auth/reset?code=…`.
 *
 * Three steps in one screen. The code in the link is traded for a session on
 * the account it was sent for; then the new password; then a way back into the
 * app. It lives on the root stack rather than in a tab because the link can
 * open the app cold, from the lock screen, with nothing underneath it to go
 * back to - which is also why there is no back arrow, only buttons that say
 * where they go.
 *
 * A link that does not work is nearly always one of two things - it expired,
 * or it was opened somewhere other than the phone that asked for it - and the
 * failure says both, because the second one is not guessable from the first.
 */

/*
 * One exchange per code, however many times the screen mounts.
 *
 * A code can be spent exactly once. Exchanging it again - a remount, React
 * running an effect twice in development, a fast refresh - fails, and if that
 * second answer is the one that lands, a link that just worked is reported as
 * broken. Holding the promise here means every mount reads the first answer.
 */
const exchanges = new Map<string, Promise<string | null>>();
function exchangeOnce(code: string): Promise<string | null> {
  let pending = exchanges.get(code);
  if (!pending) {
    pending = openRecoveryLink(code);
    exchanges.set(code, pending);
  }
  return pending;
}

type Stage = 'opening' | 'choose' | 'done' | 'failed';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const email = useAccount(useCallback((account) => account.email, []));

  // No code at all is a link the server already refused: it reports that in
  // a fragment the router never sees, so absence is the only signal there is.
  const [stage, setStage] = useState<Stage>(code ? 'opening' : 'failed');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    void exchangeOnce(code).then((failure) => {
      if (alive) setStage(failure ? 'failed' : 'choose');
    });
    return () => {
      alive = false;
    };
  }, [code]);

  const save = async () => {
    setBusy(true);
    setProblem(null);
    const failure = await setNewPassword(password);
    setBusy(false);
    if (failure) {
      setProblem(resetProblem(failure));
      return;
    }
    setPassword('');
    setStage('done');
  };

  const toProfile = () => router.replace('/(tabs)/profile');

  return (
    <Screen
      motif="rings"
      scroll={stage === 'choose'}
      header={
        <PageHeader
          title={stage === 'choose' ? 'Choose a new password' : 'Reset password'}
          back={false}
        />
      }
    >
      <Stack.Screen options={{ headerShown: false }} />

      {stage === 'opening' ? (
        <View style={styles.opening}>
          <Caption tone="faint" center>
            Opening your link…
          </Caption>
        </View>
      ) : stage === 'failed' ? (
        <EmptyState
          icon={<PersonIcon size={28} color={colors.inkFaint} />}
          title="This link did not work"
          body="It may have expired, or been opened on a different phone from the one that asked for it. Ask for a new one from Sign in on the Profile tab, and open it on this phone."
          action={<Button label="Go to Profile" variant="primary" onPress={toProfile} />}
        />
      ) : stage === 'done' ? (
        <EmptyState
          icon={<CheckIcon size={28} color={colors.brass} />}
          title="Password changed"
          body="You are signed in. Use the new password next time you sign in on another phone."
          action={<Button label="Go to Profile" variant="primary" onPress={toProfile} />}
        />
      ) : (
        <View style={styles.form}>
          {email ? <Body tone="muted">For {email}</Body> : null}
          <Panel style={styles.panel}>
            <TextField
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => void save()}
              placeholder="New password"
              secureTextEntry
              autoFocus
            />
            {problem ? <CaptionStrong tone="loss">{problem}</CaptionStrong> : null}
            <Button
              label="Save password"
              variant="primary"
              block
              loading={busy}
              disabled={busy || password.length < 6}
              onPress={() => void save()}
            />
            <Caption tone="faint">At least six characters.</Caption>
          </Panel>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  opening: { flex: 1, justifyContent: 'center' },
  form: { paddingTop: space.sm, gap: space.lg },
  panel: { gap: space.md },
});
