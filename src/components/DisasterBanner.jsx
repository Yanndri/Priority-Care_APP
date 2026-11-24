// Active disaster declarations from the MDRRMO / barangay (web console), shown at the top of a
// screen. A declaration that appears while the app is open also pops up once.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { getPublicMap, getDisasterHistory, onLiveSignal } from '../services/api';
import { splitEndReason, isGoHome } from '../utils/disasterAdvice';
import { prepareAlarm, soundAlarm, stopAlarm, onAlarmTap } from '../lib/alarm';

const HAZARD_ICON = { flood: '🌊', fire: '🔥', landslide: '⛰️', storm: '🌀', typhoon: '🌀', earthquake: '🌐', storm_surge: '🌊' };
const icon = (type) => HAZARD_ICON[type] || '⚠️';
const label = (type) => (type ? type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Disaster');

// Opens this portal's map flown to the disaster (or its barangay when it has no exact spot).
export function useShowDisasterOnMap() {
  const router = useRouter();
  const segments = useSegments();
  const isRescuer = segments[0] === '(rescuer)';
  return useCallback((e) => {
    if (!e) return;
    const params = {
      focusDisasterTs: String(Date.now()),
      focusDisasterLabel: `${label(e.hazard_type)}: ${e.name}`,
      focusDisasterNote: [`Brgy. ${e.barangay_name}`, e.location_description].filter(Boolean).join(' • '),
      focusDisasterIcon: icon(e.hazard_type),
      focusDisasterBarangay: e.barangay_name || '',
    };
    if (e.latitude != null && e.longitude != null) {
      params.focusDisasterLat = String(e.latitude);
      params.focusDisasterLng = String(e.longitude);
    }
    router.push({ pathname: isRescuer ? '/(rescuer)/map' : '/(resident)/evac-map', params });
  }, [router, isRescuer]);
}

// Pops up an alert for declarations that were not there on the previous load.
export function useNewDisasterAlert(events, { ready = true } = {}) {
  const seen = useRef(null);
  const showOnMap = useShowDisasterOnMap();
  useEffect(() => {
    if (!ready) return;
    const ids = new Set(events.map((e) => e.event_id));
    if (seen.current) {
      const fresh = events.filter((e) => !seen.current.has(e.event_id));
      if (fresh.length) {
        const title = `${icon(fresh[0].hazard_type)} Disaster declared`;
        const body = fresh.map((e) => `${e.name}\nBrgy. ${e.barangay_name}${e.location_description ? ` — ${e.location_description}` : ''}`).join('\n\n');
        // Siren, vibration and a phone notification, like an emergency broadcast.
        soundAlarm({ title: `🚨 ${title}`, body, data: { kind: 'disaster' } });
        Alert.alert(title, body, [
          { text: 'OK', onPress: stopAlarm },
          { text: 'Show on map', onPress: () => { stopAlarm(); showOnMap(fresh[0]); } },
        ], { cancelable: true, onDismiss: stopAlarm });
      }
    }
    seen.current = ids;
  }, [events, ready, showOnMap]);
}

// Pops up the admin's advice ("Safe to go home" / "Stay at the evacuation center for now")
// when a declaration that was active on the previous load has ended.
export function useEndedDisasterAlert(events, { ready = true } = {}) {
  const seen = useRef(null);
  useEffect(() => {
    if (!ready) return;
    const before = seen.current;
    seen.current = new Map(events.map((e) => [e.event_id, e]));
    if (!before) return;
    const gone = [...before.keys()].filter((id) => !seen.current.has(id));
    if (!gone.length) return;
    (async () => {
      let past = [];
      try { past = (await getDisasterHistory(10)) || []; } catch { /* offline: say it ended without the advice */ }
      for (const id of gone) {
        const ended = past.find((p) => p.event_id === id) || before.get(id);
        const { advice, reason } = splitEndReason(ended?.resolution_reason);
        const head = advice ? `${isGoHome(advice) ? '🏠' : '🏫'} ${advice}` : 'The MDRRMO ended this disaster.';
        Alert.alert(`✅ Disaster ended: ${ended?.name || 'Disaster'}`, [head, reason ? `Reason: ${reason}` : ''].filter(Boolean).join('\n\n'));
      }
    })();
  }, [events, ready]);
}

// Resident home: the advice of the latest disaster that ended in the barangay in the last 24 hours,
// shown while nothing else is declared there.
export function EndedDisasterNotice({ barangayId, activeCount = 0, style }) {
  const [last, setLast] = useState(null);
  useEffect(() => {
    if (barangayId == null || activeCount > 0) { setLast(null); return; }
    let alive = true;
    getDisasterHistory(5).then((rows) => {
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const mine = (rows || []).find((e) => e.barangay_id === barangayId && e.resolved_at && new Date(e.resolved_at).getTime() > dayAgo);
      if (alive) setLast(mine || null);
    }).catch(() => {});
    return () => { alive = false; };
  }, [barangayId, activeCount]);
  if (!last) return null;
  const { advice, reason } = splitEndReason(last.resolution_reason);
  const home = isGoHome(advice);
  return (
    <View style={[styles.ended, home ? styles.endedHome : styles.endedStay, style]} accessibilityRole="summary">
      <Text style={styles.endedTitle}>✅ {last.name} has ended</Text>
      {!!advice && <Text style={styles.endedAdvice}>{home ? '🏠' : '🏫'} {advice}</Text>}
      {!!reason && <Text style={styles.endedReason}>Reason: {reason}</Text>}
    </View>
  );
}

// Active declarations, live: reloads when the web console declares or ends one.
// barangayId limits them to one barangay (residents); leave it out for all of Cordova (rescuers).
export function useActiveDisasters({ barangayId = null, enabled = true } = {}) {
  const [events, setEvents] = useState([]);
  const [ready, setReady] = useState(false);
  const load = useCallback(async () => {
    try {
      const map = await getPublicMap();
      setEvents((map?.events || []).filter((e) => barangayId == null || e.barangay_id === barangayId));
      setReady(true);
    } catch { /* keep the last list while offline */ }
  }, [barangayId]);
  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const unsignal = onLiveSignal(['events'], load);
    const timer = setInterval(load, 30000);
    return () => { unsignal(); clearInterval(timer); };
  }, [load, enabled]);
  return { events, ready, reload: load };
}

// Mounted once per portal (in the layout) so a new declaration pops up whatever screen is open.
export function DisasterWatcher({ barangayId = null, enabled = true }) {
  const { events, ready } = useActiveDisasters({ barangayId, enabled });
  useNewDisasterAlert(events, { ready });
  useEndedDisasterAlert(events, { ready });
  useEffect(() => {
    if (!enabled) return undefined;
    prepareAlarm();
    // Tapping the phone notification stops the siren.
    return onAlarmTap('disaster', () => {});
  }, [enabled]);
  return null;
}

export default function DisasterBanner({ events, style, compact = false }) {
  const showOnMap = useShowDisasterOnMap();
  if (!events?.length) return null;
  if (compact) {
    const first = events[0];
    return (
      <TouchableOpacity style={[styles.pill, style]} accessibilityRole="button" accessibilityHint="Shows the disaster on the map" onPress={() => showOnMap(first)}>
        <Text style={styles.pillText} numberOfLines={2}>
          {icon(first.hazard_type)} {events.length > 1 ? `${events.length} active disasters: ` : 'Active disaster: '}
          {first.name} — Brgy. {first.barangay_name}  📍
        </Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={[styles.wrap, style]} accessibilityRole="alert">
      {events.map((e) => (
        <View key={e.event_id} style={styles.row}>
          <Text style={styles.icon}>{icon(e.hazard_type)}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{label(e.hazard_type)} declared: {e.name}</Text>
            <Text style={styles.sub}>
              Brgy. {e.barangay_name}{e.location_description ? ` • ${e.location_description}` : ''}
            </Text>
          </View>
          <TouchableOpacity style={styles.mapBtn} onPress={() => showOnMap(e)} accessibilityRole="button">
            <Text style={styles.mapBtnText}>📍 Show on map</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  ended: { padding: 12, borderRadius: 12, borderWidth: 1, borderLeftWidth: 5 },
  endedHome: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0', borderLeftColor: '#15803D' },
  endedStay: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A', borderLeftColor: '#B45309' },
  endedTitle: { fontSize: 14, fontWeight: '900', color: '#0F172A' },
  endedAdvice: { fontSize: 17, fontWeight: '900', color: '#0F172A', marginTop: 6 },
  endedReason: { fontSize: 13, color: '#334155', marginTop: 4 },
  wrap: { backgroundColor: '#B91C1C', paddingVertical: 10, paddingHorizontal: 14, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  icon: { fontSize: 22 },
  title: { color: '#FFF', fontSize: 15, fontWeight: '800' },
  sub: { color: '#FEE2E2', fontSize: 13, fontWeight: '600', marginTop: 2 },
  mapBtn: { backgroundColor: '#FFF', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10, alignSelf: 'center' },
  mapBtnText: { color: '#B91C1C', fontSize: 13, fontWeight: '800' },
  pill: { backgroundColor: '#B91C1C', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12, elevation: 5 },
  pillText: { color: '#FFF', fontSize: 13, fontWeight: '800' },
});
