// Forgot PIN: number -> code "by SMS" -> new PIN, then signed in.
// Prototype: no SMS provider is connected, so the code arrives as a pretend text, shown as a
// phone notification and in a message bubble on this screen. The steps match a real SMS flow.
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requestPinResetCode, resetPinWithCode } from '../../services/api';
import { notify } from '../../lib/alarm';

const WEAK_PINS = /^(\d)\1{5}$|^(012345|123456|234567|345678|456789|987654|876543|765432|654321|543210)$/;
const RESEND_S = 60;

export default function ForgotPinScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState('number'); // 'number' | 'code'
  const [contact, setContact] = useState('');
  const [masked, setMasked] = useState('');
  const [sms, setSms] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const sendCode = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await requestPinResetCode(contact);
      setMasked(res.masked);
      setSms(res.simulated_sms || '');
      setCode('');
      setStep('code');
      setWait(RESEND_S);
      if (res.simulated_sms) notify({ title: 'Messages · PriorityCare', body: res.simulated_sms, urgent: true });
    } catch (e) {
      setError(e.message);
      const m = /wait (\d+) seconds/i.exec(e.message);
      if (m) setWait(Number(m[1]));
    } finally {
      setBusy(false);
    }
  };

  const savePin = async () => {
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from the text message.');
    if (!/^\d{6}$/.test(pin)) return setError('Your new PIN must be exactly 6 digits.');
    if (WEAK_PINS.test(pin)) return setError('Pick a PIN that is harder to guess than a repeat or a straight run.');
    if (pin !== pin2) return setError("The two PINs don't match.");
    setBusy(true);
    setError('');
    try {
      await resetPinWithCode(contact, code, pin);
      router.replace('/(resident)');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const input = (props) => <TextInput style={styles.input} placeholderTextColor="#94A3B8" {...props} />;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 24 }]} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Back to sign in</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Forgot your PIN?</Text>
        <Text style={styles.sub}>
          {step === 'number'
            ? "Enter your registered mobile number. We'll text you a 6-digit code."
            : `Code sent to ${masked}. Enter it below, then choose a new PIN.`}
        </Text>

        <View style={styles.card}>
          {step === 'number' ? (
            <>
              <Text style={styles.label}>REGISTERED CONTACT NUMBER</Text>
              {input({ placeholder: 'e.g., 0917-123-4567', keyboardType: 'phone-pad', autoCorrect: false, autoCapitalize: 'none', value: contact, onChangeText: (v) => { setContact(v); setError(''); }, maxLength: 16 })}
              {!!error && <Text style={styles.error}>{error}</Text>}
              <TouchableOpacity style={[styles.primary, (busy || wait > 0) && styles.disabled]} onPress={sendCode} disabled={busy || wait > 0}>
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>{wait > 0 ? `Send code (${wait}s)` : 'Send code'}</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              {!!sms && (
                <View style={styles.smsBubble}>
                  <Text style={styles.smsFrom}>💬 Text message · PriorityCare</Text>
                  <Text style={styles.smsText}>{sms}</Text>
                </View>
              )}
              <Text style={styles.label}>6-DIGIT CODE</Text>
              {input({ placeholder: '••••••', keyboardType: 'number-pad', maxLength: 6, value: code, onChangeText: (v) => { setCode(v.replace(/\D/g, '')); setError(''); }, textContentType: 'oneTimeCode', autoComplete: 'sms-otp' })}
              <Text style={styles.label}>NEW 6-DIGIT PIN</Text>
              {input({ placeholder: '••••••', keyboardType: 'number-pad', maxLength: 6, secureTextEntry: true, value: pin, onChangeText: (v) => { setPin(v); setError(''); } })}
              <Text style={styles.label}>NEW PIN AGAIN</Text>
              {input({ placeholder: '••••••', keyboardType: 'number-pad', maxLength: 6, secureTextEntry: true, value: pin2, onChangeText: (v) => { setPin2(v); setError(''); } })}
              {!!error && <Text style={styles.error}>{error}</Text>}
              <TouchableOpacity style={[styles.primary, busy && styles.disabled]} onPress={savePin} disabled={busy}>
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>Save new PIN and sign in</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={sendCode} disabled={busy || wait > 0}>
                <Text style={[styles.secondaryText, wait > 0 && { color: '#94A3B8' }]}>
                  {wait > 0 ? `Didn't get it? Send again in ${wait}s` : "Didn't get it? Send a new code"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={() => { setStep('number'); setError(''); }} disabled={busy}>
                <Text style={styles.secondaryText}>Use a different number</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <Text style={styles.help}>
          No longer have this number? Go to your barangay hall with a valid ID and the admin can reset your PIN.
          {'\n'}In an emergency, call the MDRRMO hotline.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#F8FAFC', padding: 20 },
  back: { marginBottom: 16 },
  backText: { color: '#1E3A8A', fontSize: 12, fontWeight: '800' },
  title: { fontSize: 22, fontWeight: '900', color: '#0F172A' },
  sub: { fontSize: 13, color: '#475569', marginTop: 6, marginBottom: 16, lineHeight: 19 },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: '#E2E8F0', elevation: 4 },
  label: { fontSize: 10, fontWeight: '800', color: '#64748B', marginBottom: 6 },
  input: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 11, fontSize: 13, marginBottom: 14, color: '#0F172A', fontWeight: '600' },
  error: { color: '#B91C1C', fontSize: 12, fontWeight: '700', marginBottom: 8 },
  primary: { backgroundColor: '#DC2626', paddingVertical: 13, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  primaryText: { color: '#FFF', fontSize: 13.5, fontWeight: '800' },
  disabled: { opacity: 0.6 },
  secondary: { marginTop: 12, alignItems: 'center', paddingVertical: 4 },
  secondaryText: { color: '#1E3A8A', fontSize: 12, fontWeight: '800' },
  smsBubble: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 16 },
  smsFrom: { fontSize: 10.5, fontWeight: '800', color: '#047857', marginBottom: 4 },
  smsText: { fontSize: 13, color: '#064E3B', lineHeight: 19 },
  smsNote: { fontSize: 10, color: '#6B7280', marginTop: 6, fontStyle: 'italic' },
  help: { fontSize: 11, color: '#64748B', textAlign: 'center', marginTop: 18, lineHeight: 16 },
});
