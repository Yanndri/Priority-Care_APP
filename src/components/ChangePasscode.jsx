// "Change PIN" (households) / "Change password" (responders), shown on the profile screens.
// After staff reset a forgotten PIN on the website, the resident uses this to pick their own.
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ActivityIndicator, Alert } from 'react-native';
import { changeMyPasscode } from '../services/api';

const WEAK_PINS = /^(\d)\1{5}$|^(012345|123456|234567|345678|456789|987654|876543|765432|654321|543210)$/;

export default function ChangePasscode({ isResident }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const word = isResident ? 'PIN' : 'password';

  const close = () => { setOpen(false); setCurrent(''); setNext(''); setAgain(''); setError(''); };

  const save = async () => {
    if (!current) return setError(`Enter your current ${word}.`);
    if (isResident && !/^\d{6}$/.test(next)) return setError('The new PIN must be exactly 6 digits.');
    if (isResident && WEAK_PINS.test(next)) return setError('Pick a PIN that is harder to guess than a repeat or a straight run.');
    if (!isResident && next.length < 8) return setError('The new password must be at least 8 characters.');
    if (next !== again) return setError(`The two new ${word}s don't match.`);
    if (next === current) return setError(`The new ${word} is the same as the current one.`);
    setBusy(true);
    setError('');
    try {
      await changeMyPasscode(current, next);
      close();
      Alert.alert(`${isResident ? 'PIN' : 'Password'} changed ✅`, `Use your new ${word} the next time you sign in.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const field = (value, set, placeholder) => (
    <TextInput
      style={styles.input}
      value={value}
      onChangeText={(v) => { set(v); setError(''); }}
      placeholder={placeholder}
      secureTextEntry
      autoCapitalize="none"
      keyboardType={isResident ? 'number-pad' : 'default'}
      maxLength={isResident ? 6 : 72}
    />
  );

  return (
    <>
      <TouchableOpacity style={styles.button} onPress={() => setOpen(true)} activeOpacity={0.75}>
        <Text style={styles.buttonText}>🔑 Change {word}</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.title}>Change {word}</Text>
            {field(current, setCurrent, `Current ${word}`)}
            {field(next, setNext, isResident ? 'New 6-digit PIN' : 'New password (8+ characters)')}
            {field(again, setAgain, `New ${word} again`)}
            {!!error && <Text style={styles.error}>{error}</Text>}
            <View style={styles.row}>
              <TouchableOpacity style={[styles.action, styles.cancel]} onPress={close} disabled={busy}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.action, styles.save, busy && { opacity: 0.7 }]} onPress={save} disabled={busy}>
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: { borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFF', paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginBottom: 10 },
  buttonText: { color: '#1E3A8A', fontSize: 13, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#FFF', borderRadius: 14, padding: 18 },
  title: { fontSize: 16, fontWeight: '900', color: '#0F172A', marginBottom: 12 },
  input: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 11, fontSize: 13, marginBottom: 10, color: '#0F172A', fontWeight: '600' },
  error: { color: '#B91C1C', fontSize: 12, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  action: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  cancel: { backgroundColor: '#F1F5F9' },
  cancelText: { color: '#334155', fontWeight: '800' },
  save: { backgroundColor: '#1E3A8A' },
  saveText: { color: '#FFF', fontWeight: '800' },
});
