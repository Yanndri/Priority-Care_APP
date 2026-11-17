// Resident side, mounted once in the resident layout. Follows the rescue ticket for
// this resident's SOS and tells them each step, once per step, with a pop-up and a
// phone notification:
//   ASSIGNED -> ON THE WAY -> ARRIVED -> GOING TO A CENTER -> EVACUATED
//   (or CLOSED / CANCELLED if the SOS ends another way).
// No live position is tracked (saves the responder's battery); the steps come from
// the ticket status the responder updates in the app.
//
// Screens read the same state with useMyRescue() (the map and the home card).
import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Vibration } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMyRescueTracking, onLiveSignal } from '../services/api';
import { notify } from '../lib/alarm';

const SEEN_KEY = 'pc.rescue.seen.v2';      // { [ticketId]: { assigned: true, onTheWay: true, ... } }
const MINE_KEY = 'pc.rescue.mine.v1';      // last mission, shown while offline
const OPEN = ['assigned', 'acknowledged', 'en_route', 'on_scene'];

let snap = { mission: null, syncedAt: null, online: true };
const subs = new Set();
function setSnap(patch) {
  snap = { ...snap, ...patch };
  subs.forEach((fn) => fn(snap));
}

export function useMyRescue() {
  const [s, set] = useState(snap);
  useEffect(() => {
    subs.add(set);
    set(snap);
    return () => subs.delete(set);
  }, []);
  return s;
}

// The reserved evacuation center, for the route on the resident's map.
export function centerTargetOf(mission) {
  const a = mission?.assignment;
  if (!a || a.status !== 'reserved') return null;
  return { key: String(a.center_id), lat: Number(a.latitude), lng: Number(a.longitude), name: a.center_name };
}

// Where the rescue is now, worked out from the ticket.
export function rescueStep(m) {
  if (!m) return null;
  if (m.rescue_status === 'EVACUATED') return 'evacuated';
  if (m.status === 'cancelled') return 'cancelled';
  if (m.status === 'resolved') return 'closed';
  if (m.evacuation_started_at) return 'evacuating';
  if (m.located_at || m.status === 'on_scene') return 'arrived';
  if (m.status === 'acknowledged' || m.status === 'en_route') return 'onTheWay';
  if (m.status === 'assigned') return 'assigned';
  return null;
}

const ORDER = ['assigned', 'onTheWay', 'arrived', 'evacuating', 'evacuated', 'closed', 'cancelled'];

function centerText(m) {
  const a = m.assignment;
  return a ? [a.center_name, a.barangay_name && `Brgy. ${a.barangay_name}`].filter(Boolean).join(', ') : null;
}

// What each step tells the resident.
const STEPS = {
  assigned: (m) => ({ title: 'RESCUE TEAM ASSIGNED', lines: [
    `${m.unit_name || 'A rescue team'} has been assigned to your SOS.`,
    'Stay where you are and keep your phone with you.'] }),
  onTheWay: (m) => ({ title: 'RESCUER ON THE WAY', lines: [
    'Your rescuer is on the way. Prepare and stay in a safe, easy-to-reach spot.',
    m.unit_name ? `Rescue team: ${m.unit_name}` : null] }),
  arrived: () => ({ title: 'RESCUER ARRIVED', urgent: true, lines: [
    "Your rescuer has arrived at your location. Please follow the rescuer's instructions."] }),
  evacuating: (m) => ({ title: 'GOING TO AN EVACUATION CENTER', green: true, lines: [
    'Your rescuer is taking you to an evacuation center with space. Stay with your rescuer.',
    centerText(m) ? `Evacuation center: ${centerText(m)}` : null] }),
  evacuated: (m) => ({ title: 'YOU ARE SAFE', green: true, lines: [
    'You have arrived at the evacuation center. Please follow the staff there.',
    centerText(m) ? `Evacuation center: ${centerText(m)}` : null] }),
  closed: () => ({ title: 'SOS CLOSED', green: true, lines: [
    'The rescue team has closed your SOS.',
    'If you still need help, send a new SOS.'] }),
  cancelled: () => ({ title: 'RESCUE CANCELLED', lines: [
    'The MDRRMO cancelled this rescue.',
    'If you still need help, send a new SOS.'] }),
};

export function RescueWatcher({ enabled = true }) {
  const [alert, setAlert] = useState(null); // { title, lines, urgent, green }
  const seen = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;

    const remember = async () => {
      if (!seen.current) {
        try { seen.current = JSON.parse((await AsyncStorage.getItem(SEEN_KEY)) || '{}'); } catch { seen.current = {}; }
      }
      return seen.current;
    };

    // Show the current step once. Steps the app missed while closed are marked seen
    // too, so the resident only gets the latest one.
    const announce = async (m) => {
      const step = rescueStep(m);
      if (!step) return;
      const s = await remember();
      const mine = s[m.ticket_id] || {};
      if (mine[step]) return;
      ORDER.slice(0, ORDER.indexOf(step) + 1).forEach((k) => { mine[k] = true; });
      s[m.ticket_id] = mine;
      AsyncStorage.setItem(SEEN_KEY, JSON.stringify(s)).catch(() => {});
      const body = STEPS[step](m);
      body.lines = body.lines.filter(Boolean);
      setAlert(body);
      if (body.urgent) Vibration.vibrate([0, 700, 250, 700]);
      notify({ title: body.title, body: body.lines.join(' '), urgent: Boolean(body.urgent), data: { kind: 'rescue', ticketId: m.ticket_id, step } });
    };

    const load = async () => {
      try {
        const m = await getMyRescueTracking();
        if (!alive) return;
        setSnap({ mission: m || null, syncedAt: new Date(), online: true });
        AsyncStorage.setItem(MINE_KEY, JSON.stringify(m || null)).catch(() => {});
        announce(m);
      } catch {
        if (alive) setSnap({ online: false });
      }
    };

    // Show the last known mission at once (offline start), then refresh.
    AsyncStorage.getItem(MINE_KEY)
      .then((raw) => { if (alive && raw && !snap.mission) setSnap({ mission: JSON.parse(raw), online: false }); })
      .catch(() => {})
      .finally(load);
    const off = onLiveSignal(['tickets', 'centers', 'evacuation'], load);
    const timer = setInterval(load, 30000);
    return () => { alive = false; off(); clearInterval(timer); };
  }, [enabled]);

  if (!alert) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setAlert(null)}>
      <View style={styles.backdrop}>
        <View style={[styles.card, alert.urgent && styles.cardUrgent]}>
          <Text style={[styles.title, alert.green && { color: '#15803D' }]}>{alert.title}</Text>
          {alert.lines.map((l, i) => (
            <Text key={i} style={[styles.line, i === 0 && styles.lead]}>{l}</Text>
          ))}
          <TouchableOpacity style={[styles.btn, alert.green && { backgroundColor: '#16A34A' }]}
            onPress={() => { Vibration.cancel(); setAlert(null); }}>
            <Text style={styles.btnText}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const STEP_TEXT = {
  assigned: 'ASSIGNED: a rescue team is assigned to you',
  onTheWay: 'ON THE WAY: the rescuer is coming to you',
  arrived: 'ARRIVED: the rescuer is with you',
  evacuating: 'GOING TO AN EVACUATION CENTER',
  evacuated: 'SAFE: you are at the evacuation center',
};

// Small card for the resident's screens: who is coming and which step they are on.
export function RescueStatusCard({ mission, online = true, style }) {
  const step = rescueStep(mission);
  if (!step || !STEP_TEXT[step]) return null;
  const a = mission.assignment && mission.assignment.status === 'reserved' ? mission.assignment : null;
  return (
    <View style={[styles.statusCard, style]}>
      <Text style={styles.statusTitle}>🚑 {mission.unit_name || 'Rescue team'}</Text>
      <Text style={[styles.statusLine, { fontWeight: '900', color: step === 'evacuated' ? '#15803D' : '#B91C1C' }]}>{STEP_TEXT[step]}</Text>
      {step === 'evacuated' && <Text style={styles.statusLine}>Checked in at {mission.assignment?.center_name || 'the evacuation center'}.</Text>}
      {a && step !== 'evacuated' && (
        <Text style={[styles.statusLine, { color: '#15803D', fontWeight: '800' }]}>
          🏫 {a.center_name}{a.barangay_name ? `, Brgy. ${a.barangay_name}` : ''} ({a.headcount} places kept for you)
        </Text>
      )}
      {!online && <Text style={[styles.statusLine, { color: '#B45309' }]}>Offline: showing the last update received.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  statusCard: { backgroundColor: '#FFFFFF', borderRadius: 10, padding: 10, borderLeftWidth: 4, borderLeftColor: '#DC2626', elevation: 4, gap: 2 },
  statusTitle: { fontSize: 13, fontWeight: '900', color: '#0F172A' },
  statusLine: { fontSize: 11.5, color: '#475569' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 20, gap: 8 },
  cardUrgent: { borderWidth: 3, borderColor: '#DC2626' },
  title: { fontSize: 18, fontWeight: '900', color: '#DC2626', textAlign: 'center' },
  line: { fontSize: 14, color: '#334155', textAlign: 'center' },
  lead: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  btn: { marginTop: 8, backgroundColor: '#DC2626', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnText: { color: '#FFFFFF', fontWeight: '900', fontSize: 15 },
});
