// Pre-emptive evacuation: the household tells its barangay whether it is staying home, getting ready,
// on the way, or has arrived somewhere. Feeds the web console's Pre-emptive Evacuation page.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { getMyPreemptive, reportMyPreemptive, onLiveSignal } from '../../services/api';

// Plain choices. "preparing" stays valid in the database (older reports) but is not offered:
// "leaving now" covers it. "Back home" only appears once the household has left.
const STATUSES = [
  { id: 'staying_home', icon: '🏠', label: "We're staying home", hint: 'We are safe here and not leaving.' },
  { id: 'evacuating', icon: '🚶', label: "We're leaving now", hint: 'Going to a shelter or to another house.' },
  { id: 'arrived', icon: '✅', label: "We've arrived", hint: 'We are at a shelter or another safe place.' },
  { id: 'returned_home', icon: '↩️', label: "We're back home", hint: 'It is safe again and we went home.' },
];
// Earthquakes and fires: nobody "evacuates to a shelter" ahead of time, so only safe-at-home or
// left-the-house (plus back home) are offered.
const SUDDEN = ['earthquake', 'fire'];
const SUDDEN_STATUSES = [
  { id: 'staying_home', icon: '🏠', label: "We're safe at home", hint: 'The house is safe and we are staying.' },
  { id: 'arrived', icon: '🏃', label: 'We left the house', hint: 'We are outside or somewhere else that is safe.' },
  { id: 'returned_home', icon: '↩️', label: "We're back home", hint: 'It is safe again and we went home.' },
];
const LABELS = {
  staying_home: 'Staying home', preparing: 'Getting ready to leave', evacuating: 'Leaving now',
  arrived: 'Arrived somewhere safe', returned_home: 'Back home',
};
const DESTINATIONS = [
  { id: 'evacuation_center', label: 'Evacuation centre' },
  { id: 'relative_friend', label: "Relative's or friend's house" },
  { id: 'other', label: 'Somewhere else' },
];
const needsDestination = (status) => !['staying_home', 'returned_home'].includes(status);
const statusLabel = (id) => LABELS[id] || id;
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export default function EvacuateScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [status, setStatus] = useState(null);
  const [destType, setDestType] = useState('evacuation_center');
  const [centerId, setCenterId] = useState(null);
  const [address, setAddress] = useState('');
  const [headcount, setHeadcount] = useState(1);
  const [withMe, setWithMe] = useState([]); // member ids ticked under "Who is with you?"
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const next = await getMyPreemptive();
      setData(next);
      setError(null);
      return next;
    } catch (e) {
      setError(e.message);
      return null;
    }
  }, []);

  useEffect(() => {
    load().then((next) => {
      if (!next) return;
      const latest = next.latest;
      setHeadcount(latest?.headcount || next.household_size || 1);
      setWithMe((next.members || []).map((m) => m.member_id));
      if (latest?.destination_type) setDestType(latest.destination_type);
      setCenterId(latest?.destination_center_id ?? next.centers?.find((c) => c.is_primary)?.center_id ?? next.centers?.[0]?.center_id ?? null);
      if (latest?.destination_address) setAddress(latest.destination_address);
    });
    return onLiveSignal(['events', 'centers', 'shelter_plans', 'preemptive'], load);
  }, [load]);

  const submit = async () => {
    if (!status) return Alert.alert('Choose one', 'Tap what your household is doing right now.');
    const withDest = needsDestination(status);
    if (withDest && destType === 'evacuation_center' && !centerId) return Alert.alert('Choose a centre', 'Tap the evacuation centre you are going to.');
    if (withDest && destType !== 'evacuation_center' && !address.trim()) return Alert.alert('Where are you going?', 'Type the address or place.');
    setBusy(true);
    try {
      const next = await reportMyPreemptive({
        status,
        destinationType: withDest ? destType : null,
        centerId: withDest && destType === 'evacuation_center' ? centerId : null,
        address: withDest && destType !== 'evacuation_center' ? address.trim() : '',
        headcount: members.length ? 1 + withMe.length : headcount,
        memberIds: members.length ? withMe : null,
        note: note.trim(),
      });
      setData(next);
      setStatus(null);
      setNote('');
      Alert.alert('Sent ✅', 'Your barangay can now see where your household is.');
    } catch (e) {
      Alert.alert('Not sent', e.message);
    } finally {
      setBusy(false);
    }
  };

  const latest = data?.latest;
  const centers = data?.centers || [];
  const members = data?.members || [];
  const toggleMember = (id) => setWithMe((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} accessibilityLabel="Go back">
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Tell your barangay where you are</Text>
      </View>

      {!data && !error ? (
        <ActivityIndicator style={{ marginTop: 40 }} size="large" color="#1D4ED8" />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom, gap: 14 }}>
          {error && <Text style={styles.error}>{error}</Text>}

          {data?.active_event ? (
            <View style={styles.eventCard}>
              <Text style={styles.eventText}>⚠️ {data.active_event.name}</Text>
              <Text style={styles.eventSub}>Your barangay is asking households to report.</Text>
            </View>
          ) : data && (
            <Text style={styles.muted}>No disaster is declared for your barangay right now. You can still report.</Text>
          )}

          {latest && (
            <View style={styles.card}>
              <Text style={styles.label}>Last report • {when(latest.logged_at)}</Text>
              <Text style={styles.value}>{statusLabel(latest.status)}</Text>
              {(latest.destination_center_name || latest.destination_address) && (
                <Text style={styles.muted}>To: {latest.destination_center_name || latest.destination_address}</Text>
              )}
              <Text style={styles.muted}>{latest.headcount} person(s){latest.source !== 'resident' && latest.reported_by_name ? ` • logged by ${latest.reported_by_name}` : ''}</Text>
            </View>
          )}

          <Text style={styles.section}>Where is your household right now?</Text>
          {(SUDDEN.includes(data?.active_event?.hazard_type) ? SUDDEN_STATUSES : STATUSES).filter((s) => s.id !== 'returned_home' || ['preparing', 'evacuating', 'arrived'].includes(latest?.status)).map((s) => (
            <TouchableOpacity
              key={s.id}
              style={[styles.option, status === s.id && styles.optionOn]}
              onPress={() => setStatus(s.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: status === s.id }}
            >
              <Text style={styles.optionIcon}>{s.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionText, status === s.id && styles.optionTextOn]}>{s.label}</Text>
                <Text style={styles.muted}>{s.hint}</Text>
              </View>
            </TouchableOpacity>
          ))}

          {status && needsDestination(status) && (
            <>
              <Text style={styles.section}>{status === 'arrived' ? 'Where are you staying?' : 'Where are you going?'}</Text>
              <View style={styles.row}>
                {DESTINATIONS.map((d) => (
                  <TouchableOpacity key={d.id} style={[styles.chip, destType === d.id && styles.chipOn]} onPress={() => setDestType(d.id)}>
                    <Text style={[styles.chipText, destType === d.id && styles.chipTextOn]}>{d.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {destType === 'evacuation_center' ? (
                centers.length === 0 ? <Text style={styles.muted}>No evacuation centre is open right now.</Text> :
                centers.map((c) => (
                  <TouchableOpacity key={c.center_id} style={[styles.option, centerId === c.center_id && styles.optionOn]} onPress={() => setCenterId(c.center_id)}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionText, centerId === c.center_id && styles.optionTextOn]}>{c.center_name}</Text>
                      {c.is_primary ? <Text style={styles.tag}>★ Your barangay's designated shelter</Text>
                        : c.assigned ? <Text style={styles.tagAlt}>Backup shelter for your barangay</Text> : null}
                    </View>
                  </TouchableOpacity>
                ))
              ) : (
                <TextInput
                  style={styles.input}
                  value={address}
                  onChangeText={setAddress}
                  placeholder="Address or place (e.g. Tita Ana's house, Sitio Looc)"
                  maxLength={300}
                />
              )}
            </>
          )}

          {status && (
            <>
              {members.length > 0 ? (
                <>
                  <Text style={styles.section}>Who is with you?</Text>
                  <View style={[styles.option, styles.optionOn]}>
                    <Text style={styles.optionIcon}>☑️</Text>
                    <Text style={styles.optionText}>You</Text>
                  </View>
                  {members.map((m) => {
                    const on = withMe.includes(m.member_id);
                    return (
                      <TouchableOpacity key={m.member_id} style={[styles.option, on && styles.optionOn]} onPress={() => toggleMember(m.member_id)}
                        accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                        <Text style={styles.optionIcon}>{on ? '☑️' : '⬜'}</Text>
                        <Text style={[styles.optionText, on && styles.optionTextOn]}>{m.full_name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  <Text style={styles.muted}>{1 + withMe.length} person(s)</Text>
                </>
              ) : (
              <>
              <Text style={styles.section}>How many people are with you?</Text>
              <View style={styles.stepper}>
                <TouchableOpacity style={styles.stepBtn} onPress={() => setHeadcount((n) => Math.max(1, n - 1))} accessibilityLabel="One fewer">
                  <Text style={styles.stepBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.stepValue}>{headcount}</Text>
                <TouchableOpacity style={styles.stepBtn} onPress={() => setHeadcount((n) => Math.min(50, n + 1))} accessibilityLabel="One more">
                  <Text style={styles.stepBtnText}>+</Text>
                </TouchableOpacity>
              </View>
              </>
              )}
              <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Note for the barangay (optional)" maxLength={500} />
              <TouchableOpacity style={styles.submit} onPress={submit} disabled={busy}>
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitText}>Send to my barangay</Text>}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F5F8' },
  header: { backgroundColor: '#FFF', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#E2E8F0' },
  back: { paddingVertical: 4, alignSelf: 'flex-start' },
  backText: { color: '#1D4ED8', fontSize: 16, fontWeight: '700' },
  title: { fontSize: 20, fontWeight: '800', color: '#0F172A', marginTop: 4 },
  error: { color: '#B91C1C', fontSize: 15 },
  eventCard: { backgroundColor: '#B91C1C', borderRadius: 10, padding: 14 },
  eventText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  eventSub: { color: '#FEE2E2', fontSize: 14, marginTop: 2 },
  card: { backgroundColor: '#FFF', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#E2E8F0', gap: 2 },
  label: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  value: { fontSize: 17, color: '#0F172A', fontWeight: '800' },
  muted: { fontSize: 14, color: '#475569' },
  section: { fontSize: 17, fontWeight: '800', color: '#0F172A', marginTop: 6 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFF', borderRadius: 10, padding: 14, borderWidth: 2, borderColor: '#E2E8F0', minHeight: 56 },
  optionOn: { borderColor: '#1D4ED8', backgroundColor: '#EFF6FF' },
  optionIcon: { fontSize: 26 },
  optionText: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  optionTextOn: { color: '#1D4ED8' },
  tag: { fontSize: 13, fontWeight: '700', color: '#15803D', marginTop: 2 },
  tagAlt: { fontSize: 13, fontWeight: '600', color: '#475569', marginTop: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFF' },
  chipOn: { backgroundColor: '#1D4ED8', borderColor: '#1D4ED8' },
  chipText: { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  chipTextOn: { color: '#FFF' },
  input: { backgroundColor: '#FFF', borderRadius: 10, borderWidth: 1, borderColor: '#CBD5E1', padding: 12, fontSize: 16 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  stepBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { fontSize: 26, fontWeight: '700', color: '#1D4ED8' },
  stepValue: { fontSize: 24, fontWeight: '800', color: '#0F172A', minWidth: 40, textAlign: 'center' },
  submit: { backgroundColor: '#1D4ED8', borderRadius: 10, minHeight: 52, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  submitText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
});
