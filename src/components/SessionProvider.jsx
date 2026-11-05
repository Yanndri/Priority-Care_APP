// Keeps the signed-in user's profile (get_my_profile) available to every screen.
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { getMyProfile, onLiveSignal } from '../services/api';

const SessionContext = createContext({ profile: null, loading: true, refresh: async () => {} });

export function SessionProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setProfile(null);
      return null;
    }
    try {
      const next = await getMyProfile();
      setProfile(next);
      return next;
    } catch {
      setProfile(null);
      return null;
    }
  }, []);

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
          setProfile(null);
          Alert.alert('Signed out', 'This account is no longer active. Contact the MDRRMO.');
          router.replace('/(auth)/login');
          return;
        }
        setProfile(next);
      } catch { /* offline: keep the current profile */ }
    });
  }, [signedIn]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') setProfile(null);
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') refresh();
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  return <SessionContext.Provider value={{ profile, loading, refresh }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
