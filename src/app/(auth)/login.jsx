import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signInResident, signInRescuer } from '../../services/api';

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [role, setRole] = useState('resident');
  const [identifier, setIdentifier] = useState('');
  const [passcode, setPasscode] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!identifier.trim() || !passcode) {
      setError(role === 'resident' ? 'Enter your mobile number and PIN.' : 'Enter your email and password.');
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

  // Forgot PIN: households get a code by text (simulated in the prototype) on the Forgot PIN screen.
  // Responders have no self-service reset yet: the MDRRMO resets it on the website.
  const handleForgot = () => {
    if (role === 'resident') {
      router.push('/(auth)/forgot-pin');
      return;
    }
    Alert.alert(
      'Forgot your password?',
      'Ask the MDRRMO (Super Admin) to reset it. They will check your ID and give you a new password.\n\n'
        + 'After you sign in, you can change it under Profile > Change password.',
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 30 }]}>
      <View style={styles.brandBox}>
        <Text style={styles.badge}>MDRRMO CORDOVA</Text>
        <Text style={styles.title}>PriorityCare</Text>
        <Text style={styles.sub}>Disaster rescue and evacuation for Cordova, Cebu</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.tabRow}>
          {['resident', 'rescuer'].map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.tab, role === r && styles.tabActive]}
              onPress={() => { setRole(r); setError(''); setShowSecret(false); }}
            >
              <Text style={[styles.tabText, role === r && styles.tabTextActive]}>
                {r === 'resident' ? '🏠 Resident' : '🚑 Responder'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>
          {role === 'resident' ? 'Mobile number' : 'Email'}
        </Text>
        <TextInput
          style={styles.input}
          placeholder={role === 'resident' ? 'e.g. 0917 123 4567 or +63 917 123 4567' : 'e.g. name@prioritycare.local'}
          maxLength={role === 'resident' ? 16 : undefined}
          autoComplete={role === 'resident' ? 'tel' : 'email'}
          keyboardType={role === 'resident' ? 'phone-pad' : 'email-address'}
          autoCapitalize="none"
          autoCorrect={false}
          value={identifier}
          onChangeText={setIdentifier}
        />

        <Text style={styles.label}>{role === 'resident' ? '6-digit PIN' : 'Password'}</Text>
        {/* Show / Hide lets people check what they typed. */}
        <View style={styles.secretRow}>
        <TextInput
          style={[styles.input, styles.secretInput]}
          placeholder={role === 'resident' ? '••••••' : '••••••••'}
          secureTextEntry={!showSecret}
          keyboardType={role === 'resident' ? 'number-pad' : 'default'}
          maxLength={role === 'resident' ? 6 : undefined}
          autoCapitalize="none"
          value={passcode}
          onChangeText={setPasscode}
        />
          <TouchableOpacity
            style={styles.showBtn}
            onPress={() => setShowSecret((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={showSecret ? 'Hide' : 'Show'}
          >
            <Text style={styles.showText}>{showSecret ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={handleForgot} style={styles.forgotBtn} accessibilityRole="button">
          <Text style={styles.forgotText}>{role === 'resident' ? 'Forgot PIN?' : 'Forgot password?'}</Text>
        </TouchableOpacity>

        {!!error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity style={[styles.btnPrimary, busy && styles.btnDisabled]} onPress={handleLogin} disabled={busy}>
          {busy ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.btnPrimaryText}>
              {role === 'resident' ? 'Sign in' : 'Sign in as responder'}
            </Text>
          )}
        </TouchableOpacity>

        {role === 'resident' ? (
          <TouchableOpacity style={styles.btnSecondary} onPress={() => router.push('/(auth)/register')}>
            <Text style={styles.btnSecondaryText}>No account yet? <Text style={styles.btnSecondaryStrong}>Register your household →</Text></Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.rescuerNote}>
            🔒 Responder accounts are created by the MDRRMO on the website (RA 10121).
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
  title: { fontSize: 30, fontWeight: '900', color: '#0F172A', letterSpacing: -0.5 },
  sub: { fontSize: 13, color: '#64748B', marginTop: 4 },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: '#E2E8F0', elevation: 4 },
  tabRow: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 10, padding: 4, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: '#1E3A8A' },
  tabText: { fontSize: 13, fontWeight: '700', color: '#64748B' },
  tabTextActive: { color: '#FFF', fontWeight: '800' },
  label: { fontSize: 12, fontWeight: '800', color: '#334155', marginBottom: 6 },
  input: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 12, fontSize: 14, marginBottom: 14, color: '#0F172A', fontWeight: '600' },
  secretRow: { flexDirection: 'row', alignItems: 'flex-start' },
  secretInput: { flex: 1, paddingRight: 64 },
  showBtn: { position: 'absolute', right: 6, top: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 6 },
  showText: { color: '#1E3A8A', fontSize: 12.5, fontWeight: '800' },
  btnPrimary: { backgroundColor: '#DC2626', paddingVertical: 13, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  btnPrimaryText: { color: '#FFF', fontSize: 14.5, fontWeight: '800' },
  btnDisabled: { opacity: 0.7 },
  errorText: { color: '#B91C1C', fontSize: 12, fontWeight: '700', marginBottom: 8 },
  btnSecondary: { marginTop: 14, alignItems: 'center', paddingVertical: 6 },
  btnSecondaryText: { color: '#475569', fontSize: 13, fontWeight: '600' },
  btnSecondaryStrong: { color: '#1E3A8A', fontWeight: '800' },
  forgotBtn: { alignSelf: 'flex-end', marginTop: -6, marginBottom: 10, paddingVertical: 4 },
  forgotText: { color: '#1E3A8A', fontSize: 12.5, fontWeight: '800' },
  rescuerNote: { fontSize: 11.5, color: '#64748B', textAlign: 'center', marginTop: 12, lineHeight: 15 },
});