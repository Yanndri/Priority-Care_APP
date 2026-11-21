// Keeps the signed-in user's profile (get_my_profile) available to every screen.
// The last profile is saved on the phone, so a signed-in user who opens the app with
// no connection (the usual case during a disaster) still reaches their portal and the
// offline map instead of the login screen. `offline` is true while that saved copy is used;
// the profile is read again every 30 s and whenever the app comes back to the foreground.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { getMyProfile, onLiveSignal } from '../services/api';

const PROFILE_KEY = 'pc.profile.v1';
const RETRY_MS = 30000;

const SessionContext = createContext({ profile: null, loading: true, offline: false, refresh: async () => {} });

// A failure that only means "no connection" (as opposed to "signed out" or "not allowed").
const isNetworkFailure = (e) =>
  isAuthRetryableFetchError(e) || /network request failed|fetch failed|no connection|timed? ?out|aborted/i.test(e?.message || '');

async function readSavedProfile(uid) {
  try {
    const saved = JSON.parse((await AsyncStorage.getItem(PROFILE_KEY)) || 'null');
    // Only the same login's copy; a saved profile never signs anyone in by itself.
    return saved && (!uid || saved.uid === uid) ? saved : null;
  } catch {
    return null;
  }
}
const saveProfile = (p) => AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p)).catch(() => {});
const forgetProfile = () => AsyncStorage.removeItem(PROFILE_KEY).catch(() => {});

export function SessionProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const offlineRef = useRef(false);
  const markOffline = (v) => { offlineRef.current = v; setOffline(v); };

  const refresh = useCallback(async () => {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (!session) {
      // An expired token that could not be renewed because there is no connection keeps
      // the login on the phone (supabase-js only clears it on a real sign-out or rejection).
      if (sessionError && isNetworkFailure(sessionError)) {
        const saved = await readSavedProfile(null);
        if (saved) {
          setProfile(saved);
          markOffline(true);
          return saved;
        }
      }
      const wasOffline = offlineRef.current;
      await forgetProfile();
      setProfile(null);
      markOffline(false);
      // Back online, but the login was rejected while the saved copy was in use.
      if (wasOffline) router.replace('/(auth)/login');
      return null;
    }
    try {
      const next = await getMyProfile();
      if (next) await saveProfile(next);
      else await forgetProfile();
      setProfile(next);
      markOffline(false);
      return next;
    } catch (e) {
      if (isNetworkFailure(e)) {
        const saved = await readSavedProfile(session.user?.id);
        if (saved) {
          setProfile(saved);
          markOffline(true);
          return saved;
        }
      }
      setProfile(null);
      markOffline(false);
      return null;
    }
  }, []);

  // While running on the saved copy, keep trying to reach the server.
  useEffect(() => {
    if (!offline) return undefined;
    const retry = () => { refresh().catch(() => {}); };
    const timer = setInterval(retry, RETRY_MS);
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') retry(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [offline, refresh]);

  // Re-reads the profile when the web console changes residents or accounts (verified badge,
  // suspension). A failed read keeps the current profile; a suspended or archived account is signed out.
  const signedIn = profile != null;
  useEffect(() => {
    if (!signedIn) return undefined;
    return onLiveSignal(['residents', 'accounts'], async () => {
      try {
        const next = await getMyProfile();
        if (!next) return;
        if (next.account_status !== 'active') {
          await supabase.auth.signOut();
          await forgetProfile();
          setProfile(null);
          Alert.alert('Signed out', 'This account is no longer active. Contact the MDRRMO.');
          router.replace('/(auth)/login');
          return;
        }
        await saveProfile(next);
        setProfile(next);
        if (offlineRef.current) markOffline(false);
      } catch { /* offline: keep the current profile */ }
    });
  }, [signedIn]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        forgetProfile();
        setProfile(null);
        markOffline(false);
      }
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') refresh();
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  return <SessionContext.Provider value={{ profile, loading, offline, refresh }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
