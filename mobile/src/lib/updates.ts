import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { usePathname } from 'expo-router';
import * as Updates from 'expo-updates';

/**
 * Over-the-air updates, applied without asking.
 *
 * Most changes to this app are JavaScript - screens, copy, the scoring engine -
 * and none of them need a new binary. Publishing those with `eas update` takes
 * about a minute against the fifteen a build costs, so the only thing standing
 * between a fix and the phone is whether the phone picks it up.
 *
 * Unlike apps that ask before restarting, this one does
 * not: a scoring app is opened for a few minutes at a time between hands, and
 * a dialog that appears while somebody is mid-hand is a worse interruption
 * than the restart it is trying to warn about. Downloaded updates already
 * apply silently on the next cold launch; forcing the reload only changes
 * *when*, not *whether*, and skipping the question means nobody ends up
 * running week-old code because they tapped Later twice.
 *
 * What it will not do is reload on top of work in progress. A hand being
 * entered lives in memory, so restarting halfway through scoring one would
 * throw it away to deliver a change the player did not ask for and cannot see.
 * Inside the hand flow the update waits - it is already downloaded, so it
 * lands the moment they leave, and on the next cold launch regardless.
 */

export type UpdateStatus = 'idle' | 'ready' | 'applying';

/** Routes where a reload would destroy something the player has typed. */
function isMidTask(pathname: string): boolean {
  return pathname.startsWith('/hand') || pathname.startsWith('/rules/edit');
}

export function useOtaUpdates(): UpdateStatus {
  const [downloaded, setDownloaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const pathname = usePathname();
  const checking = useRef(false);

  /*
   * Derived rather than stored.
   *
   * "About to reload" is entirely a function of what has been downloaded and
   * where the player is standing, so making it state as well would mean an
   * effect setting state during render - which the compiler rejects, and
   * rightly: there would then be two answers to the same question and a frame
   * where they disagree.
   */
  const applying = downloaded && !failed && !isMidTask(pathname);

  // --- find and download ----------------------------------------------------
  useEffect(() => {
    const run = async () => {
      // expo-updates is inert in Expo Go and in dev, where checking it only
      // produces noise in the log.
      if (__DEV__ || !Updates.isEnabled || checking.current) return;
      checking.current = true;
      try {
        const check = await Updates.checkForUpdateAsync();
        if (!check.isAvailable) return;
        await Updates.fetchUpdateAsync();
        setDownloaded(true);
      } catch {
        // Offline, or nothing published to this channel yet. Either way the
        // installed bundle is fine and this is not worth telling anyone about.
      } finally {
        checking.current = false;
      }
    };

    void run();
    // Checked again on every return to the foreground: a phone that is never
    // fully closed would otherwise only ever check once, which is the exact
    // case that leaves somebody on stale code for days.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void run();
    });
    return () => sub.remove();
  }, []);

  // --- apply ----------------------------------------------------------------
  useEffect(() => {
    if (!applying) return;
    // The catch runs on a later tick, so this never sets state synchronously.
    // Giving up is safe: the update is already on disk, so the next cold
    // launch applies it with no further help from us.
    Updates.reloadAsync().catch(() => setFailed(true));
  }, [applying]);

  if (applying) return 'applying';
  return downloaded ? 'ready' : 'idle';
}
