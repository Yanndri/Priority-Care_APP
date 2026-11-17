// Resident side, mounted once in the resident layout. Follows the rescue unit
// assigned to this resident's SOS: its live position (Supabase Realtime on
// rescue_unit_locations), the proximity stage and the reserved evacuation
// center. Shows a RESCUE ALERT when the unit is 100 m, 10 m and 5 m away and
// an EVACUATION CENTER ASSIGNED alert, each once per mission.
//
// Screens read the same state with useMyRescue() (the map and the home card).
import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Vibration } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMyRescueTracking, subscribeUnitLocation, onLiveSignal } from '../services/api';
import { notify } from '../lib/alarm';
import { formatDistance } from '../lib/location';

const SEEN_KEY = 'pc.rescue.seen.v1';      // { [ticketId]: { approaching, nearby, critical, center } }
const MINE_KEY = 'pc.rescue.mine.v1';      // last mission, shown while offline
export const UNIT_STALE_MS = 60000;
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

// For OfflineMap's rescuerPoint prop.
export function rescuerPointOf(mission) {
  const l = mission?.location;
  if (!l || !OPEN.includes(mission.status)) return null;
  const at = l.recorded_at ? new Date(l.recorded_at).getTime() : 0;
  return {
    lat: Number(l.latitude), lng: Number(l.longitude), accuracy: l.accuracy_m,
    label: mission.unit_name || 'Rescue unit', stale: Date.now() - at > UNIT_STALE_MS,
  };
}

export function centerTargetOf(mission) {
  const a = mission?.assignment;
  if (!a || a.status !== 'reserved') return null;
  return { key: String(a.center_id), lat: Number(a.latitude), lng: Number(a.longitude), name: a.center_name };
}

// Wording agreed for the pilot.
export const MESSAGES = {
  onTheWay: '🚑 Your rescuer is on the way! Please prepare for assistance and stay in a safe, accessible area.',
  arrived: "✅ Your rescuer has arrived at your location. Please follow the rescuer's instructions.",
  evacuating: '🚨 Your rescuer is guiding you to a nearby evacuation center with available capacity. Please stay with your rescuer and follow their instructions.',
  evacuated: '✅ You have successfully arrived at the evacuation center. Please follow the instructions of the emergency personnel.',
};

const STAGES = {
  approaching: { rank: 1, text: 'A rescuer is approaching your location.' },
  nearby: { rank: 2, text: 'A rescuer is very close to your location.' },
  critical: { rank: 3, text: 'A rescuer is approximately 5 meters away from your location!' },
};

export function RescueWatcher({ enabled = true }) {
  const [alert, setAlert] = useState(null); // { kind: 'stage'|'center', title, lines, urgent }
  const seen = useRef(null);
  const unitSub = useRef({ unitId: null, off: null });

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;

    const remember = async () => {
      if (!seen.current) {
        try { seen.current = JSON.parse((await AsyncStorage.getItem(SEEN_KEY)) || '{}'); } catch { seen.current = {}; }
      }
      return seen.current;
    };
    const saveSeen = () => AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen.current || {})).catch(() => {});

    const announce = async (m) => {
      if (!m) return;
      const s = await remember();
      const mine = s[m.ticket_id] || {};
      let changed = false;
      const show = (key, alertBody, urgent = false) => {
        setAlert({ ...alertBody, urgent });
        if (urgent) Vibration.vibrate([0, 700, 250, 700, 250, 700]);
        notify({ title: alertBody.title, body: alertBody.lines.join(' '), urgent, data: { kind: 'rescue', ticketId: m.ticket_id, key } });
      };

      // Mission milestones, each shown once per mission. If the app was closed through
      // several of them, only the latest is shown and the earlier ones are marked seen.
      const a = m.assignment;
      const center = a ? [a.center_name, a.barangay_name && `Brgy. ${a.barangay_name}`].filter(Boolean).join(', ') : null;
      const milestones = [
        { key: 'onTheWay', due: OPEN.includes(m.status) || m.rescue_status === 'EVACUATED',
          body: { kind: 'stage', title: 'RESCUER ON THE WAY', lines: [MESSAGES.onTheWay, m.unit_name ? `Rescue team: ${m.unit_name}` : null].filter(Boolean) } },
        { key: 'arrived', due: Boolean(m.located_at),
          body: { kind: 'stage', title: 'RESCUER ARRIVED', lines: [MESSAGES.arrived] }, urgent: true },
        { key: 'evacuating', due: Boolean(m.evacuation_started_at),
          body: { kind: 'center', title: 'GOING TO AN EVACUATION CENTER', lines: [MESSAGES.evacuating,
            center ? `Evacuation center: ${center}` : null,
            a ? `${a.headcount} ${a.headcount === 1 ? 'slot is' : 'slots are'} reserved for your household.` : null].filter(Boolean) } },
        { key: 'evacuated', due: m.rescue_status === 'EVACUATED',
          body: { kind: 'center', title: 'SUCCESSFULLY EVACUATED', lines: [MESSAGES.evacuated, center ? `Evacuation center: ${center}` : null].filter(Boolean) } },
      ];
      const dueNew = milestones.filter((x) => x.due && !mine[x.key]);
      if (dueNew.length) {
        dueNew.forEach((x) => { mine[x.key] = true; });
        const latest = dueNew[dueNew.length - 1];
        show(latest.key, latest.body, latest.urgent);
        changed = true;
      }

      // Proximity while the rescuer approaches: one alert per stage, never after arrival.
      const stage = STAGES[m.proximity_stage];
      if (OPEN.includes(m.status) && stage && !mine[m.proximity_stage] && !m.located_at && !dueNew.length) {
        Object.keys(STAGES).forEach((k) => { if (STAGES[k].rank <= stage.rank) mine[k] = true; });
        changed = true;
        const d = m.location?.target === 'resident' && m.location?.distance_m != null ? m.location.distance_m : null;
        show(m.proximity_stage, { kind: 'stage', title: 'RESCUE ALERT', lines: [stage.text,
          d != null ? `Distance: about ${formatDistance(d)}` : null,
          'Please make yourself visible and stay where you are.'].filter(Boolean) }, m.proximity_stage === 'critical');
      }

      if (changed) {
        s[m.ticket_id] = mine;
        saveSeen();
      }
    };

    const followUnit = (unitId) => {
      if (unitSub.current.unitId === unitId) return;
      unitSub.current.off?.();
      unitSub.current = { unitId, off: null };
      if (!unitId) return;
      unitSub.current.off = subscribeUnitLocation(unitId, (row) => {
        const m = snap.mission;
        if (!m || row.ticket_id !== m.ticket_id) return;
        const location = {
          latitude: row.latitude, longitude: row.longitude, accuracy_m: row.accuracy_m, heading: row.heading,
          recorded_at: row.recorded_at, received_at: row.received_at, distance_m: row.distance_m, target: row.target,
        };
        const next = { ...m, location, proximity_stage: row.proximity_stage || m.proximity_stage };
        setSnap({ mission: next, online: true });
        if (row.proximity_stage && row.proximity_stage !== m.proximity_stage) announce(next);
      });
    };

    const load = async () => {
      try {
        const m = await getMyRescueTracking();
        if (!alive) return;
        setSnap({ mission: m || null, syncedAt: new Date(), online: true });
        AsyncStorage.setItem(MINE_KEY, JSON.stringify(m || null)).catch(() => {});
        followUnit(m && OPEN.includes(m.status) ? m.unit_id : null);
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
    return () => {
      alive = false;
      off();
      clearInterval(timer);
      unitSub.current.off?.();
      unitSub.current = { unitId: null, off: null };
    };
  }, [enabled]);

  if (!alert) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setAlert(null)}>
      <View style={styles.backdrop}>
        <View style={[styles.card, alert.urgent && styles.cardUrgent]}>
          <Text style={[styles.title, alert.kind === 'center' && { color: '#15803D' }]}>{alert.title}</Text>
          {alert.lines.map((l, i) => (
            <Text key={i} style={[styles.line, i === 0 && styles.lead]}>{l}</Text>
          ))}
          <TouchableOpacity style={[styles.btn, alert.kind === 'center' && { backgroundColor: '#16A34A' }]}
            onPress={() => { Vibration.cancel(); setAlert(null); }}>
            <Text style={styles.btnText}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const sinceText = (iso) => {
  if (!iso) return 'no position yet';
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `updated ${sec}s ago`;
  const min = Math.round(sec / 60);
  return min < 60 ? `updated ${min} min ago` : `updated ${Math.round(min / 60)} h ago`;
};

// rescue_status from the server -> what the resident reads.
const STATUS_TEXT = {
  ASSIGNED: 'ASSIGNED: rescue team assigned', ON_THE_WAY: 'ON THE WAY: rescuer coming to you',
  ARRIVED: 'ARRIVED: rescuer is with you', EVACUATING: 'EVACUATING: going to an evacuation center',
  EVACUATED: 'EVACUATED: you are at the evacuation center',
};

// Small live card for the resident's screens: who is coming, how far, how fresh.
export function RescueStatusCard({ mission, online = true, style }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 10000);
    return () => clearInterval(t);
  }, []);
  if (!mission) return null;
  const evacuated = mission.rescue_status === 'EVACUATED';
  if (!OPEN.includes(mission.status) && !evacuated) return null;
  const l = evacuated ? null : mission.location;
  const point = rescuerPointOf(mission);
  const a = mission.assignment && mission.assignment.status === 'reserved' ? mission.assignment : null;
  let line2;
  if (evacuated) line2 = `Checked in at ${mission.assignment?.center_name || 'the evacuation center'}.`;
  else if (!l) line2 = 'Waiting for the rescue team\'s live position';
  else {
    const d = l.distance_m != null ? formatDistance(l.distance_m) : null;
    line2 = [d && (l.target === 'center' ? `${d} from the evacuation center` : `about ${d} from you`),
      l.accuracy_m != null ? `GPS ±${Math.round(l.accuracy_m)} m` : null,
      point?.stale ? `last known position, ${sinceText(l.recorded_at)}` : `live, ${sinceText(l.recorded_at)}`]
      .filter(Boolean).join(' • ');
  }
  return (
    <View style={[styles.statusCard, style]}>
      <Text style={styles.statusTitle}>🚑 {mission.unit_name || 'Rescue team'}</Text>
      <Text style={[styles.statusLine, { fontWeight: '900', color: evacuated ? '#15803D' : '#B91C1C' }]}>{STATUS_TEXT[mission.rescue_status] || mission.status}</Text>
      <Text style={[styles.statusLine, point?.stale && { color: '#B45309' }]}>{line2}</Text>
      {a && !evacuated && (
        <Text style={[styles.statusLine, { color: '#15803D', fontWeight: '800' }]}>
          🏫 {a.center_name}{a.barangay_name ? `, Brgy. ${a.barangay_name}` : ''} ({a.headcount} slots reserved)
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
