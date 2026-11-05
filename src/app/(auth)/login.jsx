import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signInResident, signInRescuer } from '../../services/api';

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [role, setRole] = useState('resident');
  const [identifier, setIdentifier] = useState('');
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!identifier.trim() || !passcode) {
      setError(role === 'resident' ? 'Enter your contact number and PIN.' : 'Enter your email and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (role === 'rescuer') {
        await signInRescuer(identifier, passcode);
        router.replace('/(rescuer)/map');
      } else {
        await signInResident(identifier, passcode);
        router.replace('/(resident)');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 30 }]}>
      <View style={styles.brandBox}>
        <Text style={styles.badge}>MDRRMO CORDOVA • EDSS</Text>
        <Text style={styles.title}>PriorityCare</Text>
        <Text style={styles.sub}>Emergency Triage & Tactical Dispatch System</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.tabRow}>
          {['resident', 'rescuer'].map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.tab, role === r && styles.tabActive]}
              onPress={() => { setRole(r); setError(''); }}
            >
              <Text style={[styles.tabText, role === r && styles.tabTextActive]}>
                {r === 'resident' ? '🏠 Household' : '🚑 Rescuer MDT'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>
          {role === 'resident' ? 'REGISTERED CONTACT NUMBER' : 'RESPONDER EMAIL'}
        </Text>
        <TextInput
          style={styles.input}
          placeholder={role === 'resident' ? 'e.g., 0917-123-4567' : 'e.g., rescuer.alegria@prioritycare.local'}
          keyboardType={role === 'resident' ? 'phone-pad' : 'email-address'}
          autoCapitalize="none"
          autoCorrect={false}
          value={identifier}
          onChangeText={setIdentifier}
        />

        <Text style={styles.label}>{role === 'resident' ? '6-DIGIT PIN' : 'PASSWORD'}</Text>
        <TextInput
          style={styles.input}
          placeholder={role === 'resident' ? '••••••' : '••••••••'}
          secureTextEntry
          keyboardType={role === 'resident' ? 'number-pad' : 'default'}
          maxLength={role === 'resident' ? 6 : undefined}
          autoCapitalize="none"
          value={passcode}
          onChangeText={setPasscode}
        />

        {!!error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity style={[styles.btnPrimary, busy && styles.btnDisabled]} onPress={handleLogin} disabled={busy}>
          {busy ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.btnPrimaryText}>
              {role === 'resident' ? 'Enter Household Portal' : 'Launch Tactical Terminal'}
            </Text>
          )}
        </TouchableOpacity>

        {role === 'resident' ? (
          <TouchableOpacity style={styles.btnSecondary} onPress={() => router.push('/(auth)/register')}>
            <Text style={styles.btnSecondaryText}>New Household? Register Profile →</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.rescuerNote}>
            🔒 Responder accounts are provisioned exclusively via the MDRRMO EOC Web Console under RA 10121.
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC', padding: 20, justifyContent: 'center' },
  brandBox: { alignItems: 'center', marginBottom: 24 },
  badge: { fontSize: 10, fontWeight: '900', color: '#DC2626', backgroundColor: '#FEF2F2', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '900', color: '#0F172A' },
  sub: { fontSize: 12, color: '#64748B', marginTop: 4 },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: '#E2E8F0', elevation: 4 },
  tabRow: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 10, padding: 4, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: '#1E3A8A' },
  tabText: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  tabTextActive: { color: '#FFF', fontWeight: '800' },
  label: { fontSize: 10, fontWeight: '800', color: '#64748B', marginBottom: 6 },
  input: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 11, fontSize: 13, marginBottom: 14, color: '#0F172A', fontWeight: '600' },
  btnPrimary: { backgroundColor: '#DC2626', paddingVertical: 13, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  btnPrimaryText: { color: '#FFF', fontSize: 13.5, fontWeight: '800' },
  btnDisabled: { opacity: 0.7 },
  errorText: { color: '#B91C1C', fontSize: 12, fontWeight: '700', marginBottom: 8 },
  btnSecondary: { marginTop: 14, alignItems: 'center', paddingVertical: 6 },
  btnSecondaryText: { color: '#1E3A8A', fontSize: 12, fontWeight: '800' },
  rescuerNote: { fontSize: 10.5, color: '#64748B', textAlign: 'center', marginTop: 12, lineHeight: 15 },
});