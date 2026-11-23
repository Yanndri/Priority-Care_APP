// Resident home: who in the household is at an evacuation center right now, and a
// "Check out" button so the household can record leaving without the barangay staff.
// Also tells the resident once when someone in the household is checked in at a center
// (for example by a responder or the center staff).
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Alert, ActivityIndicator, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { checkOutMyHousehold } from '../services/api';
import { notify } from '../lib/alarm';

const SEEN_KEY = 'pc.atCentre.seen.v1'; // { [personId]: 'center|status' }
const AT_CENTRE = ['safely_evacuated', 'in_transit'];
const idOf = (p) => p.member_id || p.uid;

export default function AtCentreCard({ people = [], profileUid, activeDisasters = [], onDone, style }) {
  const here = people.filter((p) => AT_CENTRE.includes(p.evac_status) && p.center_name);
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState([]);
  const [busy, setBusy] = useState(false);

  // Tell the resident once per new check-in.
  const signature = here.map((p) => `${idOf(p)}:${p.center_name}:${p.evac_status}`).join(',');
  useEffect(() => {
    if (!profileUid) return;
    let alive = true;
    (async () => {
      let seen = {};
      try { seen = JSON.parse((await AsyncStorage.getItem(`${SEEN_KEY}:${profileUid}`)) || '{}'); } catch { seen = {}; }
      const fresh = here.filter((p) => p.evac_status === 'safely_evacuated' && seen[idOf(p)] !== `${p.center_name}|${p.evac_status}`);
      const next = {};
      here.forEach((p) => { next[idOf(p)] = `${p.center_name}|${p.evac_status}`; });
      AsyncStorage.setItem(`${SEEN_KEY}:${profileUid}`, JSON.stringify(next)).catch(() => {});
      if (!alive || !fresh.length) return;
      const lines = fresh.map((p) => `${p.uid === profileUid ? 'You' : p.name}: ${p.center_name}`).join('\n');
      Alert.alert('🏫 Checked in at an evacuation center', `${lines}\n\nWhen you leave, tap "Check out" on your home screen.`);
      notify({ title: 'Checked in at an evacuation center', body: lines.replace(/\n/g, ' • '), data: { kind: 'at_centre' } });
    })();
    return () => { alive = false; };
  }, [signature, profileUid]);

  if (!here.length) return null;

  const start = () => {
    setTicked(here.map(idOf));
    setOpen(true);
  };

  const send = async (confirmed = false) => {
    if (!ticked.length) return Alert.alert('Nobody ticked', 'Tick who left the center.');
    if (activeDisasters.length && !confirmed) {
      return Alert.alert(
        'The disaster is not over yet ⚠️',
        `${activeDisasters[0].name || 'A disaster'} is still declared in your barangay. The MDRRMO will announce when it is safe to go home. Leave the center anyway?`,
        [
          { text: 'Stay for now', style: 'cancel' },
          { text: 'Yes, we left', style: 'destructive', onPress: () => send(true) },
        ],
      );
    }
    setBusy(true);
    try {
      const all = ticked.length === here.length;
      await checkOutMyHousehold(all ? null : ticked);
      setOpen(false);
      Alert.alert('Checked out ✅', all
        ? 'Your barangay can see your household left the center.'
        : `${ticked.length} checked out. The others are still listed at the center.`);
      onDone?.();
    } catch (e) {
      Alert.alert('Not saved', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.card, style]}>
      <Text style={styles.kicker}>🏫 AT AN EVACUATION CENTER</Text>
      {here.map((p) => (
        <Text key={idOf(p)} style={styles.line}>
          <Text style={styles.name}>{p.uid === profileUid ? 'You' : p.name}</Text>
          {` • ${p.center_name}${p.evac_status === 'in_transit' ? ' (on the way)' : ''}`}
        </Text>
      ))}
      <TouchableOpacity style={styles.btn} onPress={start} accessibilityRole="button">
        <Text style={styles.btnText}>↩ Check out (we left the center)</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.title}>Who left the center?</Text>
            <Text style={styles.sub}>Untick anyone who is staying.</Text>
            <ScrollView style={{ flexGrow: 0 }}>
              {here.map((p) => {
                const on = ticked.includes(idOf(p));
                return (
                  <TouchableOpacity key={idOf(p)} style={styles.row}
                    onPress={() => setTicked((t) => (on ? t.filter((x) => x !== idOf(p)) : [...t, idOf(p)]))}>
                    <Text style={styles.tick}>{on ? '☑' : '☐'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{p.uid === profileUid ? `${p.name} (you)` : p.name}</Text>
                      <Text style={styles.sub}>{p.center_name}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={[styles.btn, { marginTop: 8 }]} onPress={() => send()} disabled={busy}>
              {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnText}>Check out {ticked.length} of {here.length}</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setOpen(false)} style={{ alignItems: 'center', paddingTop: 10 }}>
              <Text style={styles.cancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0', borderRadius: 10, padding: 12, gap: 4 },
  kicker: { fontSize: 11, fontWeight: '900', color: '#15803D', letterSpacing: 0.4 },
  line: { fontSize: 13, color: '#334155' },
  name: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  btn: { backgroundColor: '#15803D', borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginTop: 4 },
  btnText: { color: '#FFF', fontWeight: '900', fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  dialog: { backgroundColor: '#FFF', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, gap: 6, maxHeight: '85%' },
  title: { fontSize: 17, fontWeight: '900', color: '#0F172A' },
  sub: { fontSize: 12, color: '#475569' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  tick: { fontSize: 22, color: '#15803D' },
  cancel: { fontSize: 13, fontWeight: '800', color: '#1D4ED8' },
});
