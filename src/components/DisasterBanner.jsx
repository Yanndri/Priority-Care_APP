// Active disaster declarations from the MDRRMO / barangay (web console), shown at the top of a
// screen. A declaration that appears while the app is open also pops up once.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { getPublicMap, onLiveSignal } from '../services/api';
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
