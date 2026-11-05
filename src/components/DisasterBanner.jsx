// Active disaster declarations from the MDRRMO / barangay (web console), shown at the top of a
// screen. A declaration that appears while the app is open also pops up once.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { getPublicMap, onLiveSignal } from '../services/api';

const HAZARD_ICON = { flood: '🌊', fire: '🔥', landslide: '⛰️', storm: '🌀', typhoon: '🌀', earthquake: '🌐', storm_surge: '🌊' };
const icon = (type) => HAZARD_ICON[type] || '⚠️';
const label = (type) => (type ? type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Disaster');

// Pops up an alert for declarations that were not there on the previous load.
export function useNewDisasterAlert(events, { ready = true } = {}) {
  const seen = useRef(null);
  useEffect(() => {
    if (!ready) return;
    const ids = new Set(events.map((e) => e.event_id));
    if (seen.current) {
      const fresh = events.filter((e) => !seen.current.has(e.event_id));
      if (fresh.length) {
        Alert.alert(
          `${icon(fresh[0].hazard_type)} Disaster declared`,
          fresh.map((e) => `${e.name}\nBrgy. ${e.barangay_name}${e.location_description ? ` — ${e.location_description}` : ''}`).join('\n\n'),
        );
      }
    }
    seen.current = ids;
  }, [events, ready]);
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
  return null;
}

export default function DisasterBanner({ events, style, compact = false }) {
  if (!events?.length) return null;
  if (compact) {
    const first = events[0];
    return (
      <View style={[styles.pill, style]} accessibilityRole="alert">
        <Text style={styles.pillText} numberOfLines={2}>
          {icon(first.hazard_type)} {events.length > 1 ? `${events.length} active disasters: ` : 'Active disaster: '}
          {first.name} — Brgy. {first.barangay_name}
        </Text>
      </View>
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
  pill: { backgroundColor: '#B91C1C', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12, elevation: 5 },
  pillText: { color: '#FFF', fontSize: 13, fontWeight: '800' },
});
