// Rings the rescuer's phone when a new SOS comes in: a loud siren, vibration, a phone
// notification (src/lib/alarm.js), and a full-screen red alert. Mounted once in the rescuer layout so it works
// on every rescuer screen. Alerts that are already open when the app starts do not ring.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { prepareAlarm, soundAlarm, stopAlarm, onAlarmTap } from '../lib/alarm';
import { getRescuerFeed, listBarangays, onLiveSignal, subscribe } from '../services/api';
import { EMERGENCY_TYPES } from '../constants/options';

const POLL_MS = 15000;

const LEVEL = { 3: 'Critical', 2: 'Needs help', 1: 'Low' };
const typeLabel = (type) => {
  const t = EMERGENCY_TYPES.find((e) => e.id === type);
  return t ? `${t.icon} ${t.label}` : `⚠️ ${type ? type.charAt(0) + type.slice(1).toLowerCase() : 'Emergency'}`;
};

// One entry per SOS the rescuer can see: their unit's tickets and the open SOS calls.
function sosItems(feed, barangayNames) {
  const items = [];
  (feed.tickets || []).forEach((t) => {
    if (!t.sos || t.sos.status === 'cancelled' || t.sos.status === 'resolved') return;
    items.push({
      key: `T-${t.ticket_id}`,
      sameAs: `${t.sos.created_at}|${t.sos.alert_type}`,
      mine: true,
      type: t.sos.alert_type,
      level: t.sos.alert_level,
      name: t.resident?.name || t.subject || 'Resident',
      place: t.barangay_name ? `Brgy. ${t.barangay_name}` : '',
      headcount: t.sos.headcount,
    });
  });
  (feed.active_sos || []).forEach((a) => {
    items.push({
      key: `A-${a.alert_id}`,
      sameAs: `${a.created_at}|${a.alert_type}`,
      mine: false,
      type: a.alert_type,
      level: a.alert_level,
      name: a.resident_name || 'Resident',
      place: barangayNames[a.barangay_id] ? `Brgy. ${barangayNames[a.barangay_id]}` : '',
      headcount: a.headcount,
    });
  });
  return items;
}

export function SosWatcher({ enabled = true }) {
  const router = useRouter();
  const [ringing, setRinging] = useState([]); // the new SOS calls shown on the red screen
  const seen = useRef(null);
  const names = useRef({});

  const silence = useCallback(() => {
    stopAlarm();
    setRinging([]);
  }, []);

  const ring = useCallback((fresh) => {
    setRinging((now) => [...fresh, ...now].slice(0, 5));
    const first = fresh[0];
    soundAlarm({
      title: fresh.length > 1
        ? `🚨 ${fresh.length} new SOS alerts`
        : `🚨 ${first.mine ? 'SOS assigned to your unit' : 'New SOS alert'}`,
      body: fresh.map((s) => `${typeLabel(s.type)} • ${s.name}${s.place ? `, ${s.place}` : ''}`).join('\n'),
      data: { kind: 'sos' },
    });
  }, []);

  const check = useCallback(async () => {
    try {
      const feed = await getRescuerFeed();
      const items = sosItems(feed, names.current);
      if (seen.current) {
        // A ticket for an SOS that already rang only rings again because it was just assigned to you.
        const fresh = items.filter((s) => !seen.current.has(s.key));
        const byCall = new Map();
        fresh.forEach((s) => { if (!byCall.has(s.sameAs) || s.mine) byCall.set(s.sameAs, s); });
        if (byCall.size) ring([...byCall.values()]);
        items.forEach((s) => seen.current.add(s.key));
      } else {
        seen.current = new Set(items.map((s) => s.key));
      }
    } catch { /* offline: try again on the next change or poll */ }
  }, [ring]);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    prepareAlarm();
    listBarangays()
      .then((list) => { if (alive) names.current = Object.fromEntries(list.map((b) => [b.barangay_id, b.barangay_name])); })
      .catch(() => {})
      .finally(() => { if (alive) check(); });

    const unsubscribe = subscribe(['sos_alerts', 'dispatch_tickets'], check);
    const unsignal = onLiveSignal(['sos', 'tickets'], check);
    const timer = setInterval(check, POLL_MS);
    // Tapping the phone notification opens the SOS list and stops the siren.
    const untap = onAlarmTap('sos', () => {
      setRinging([]);
      router.push('/(rescuer)');
    });
    return () => {
      alive = false;
      unsubscribe();
      unsignal();
      clearInterval(timer);
      untap();
      stopAlarm();
    };
  }, [enabled, check, silence, router]);

  const open = () => {
    silence();
    router.push('/(rescuer)');
  };

  return (
    <Modal visible={ringing.length > 0} animationType="fade" transparent={false} onRequestClose={silence}>
      <View style={styles.screen} accessibilityRole="alert">
        <Text style={styles.siren}>🚨</Text>
        <Text style={styles.title}>{ringing.length > 1 ? `${ringing.length} NEW SOS ALERTS` : 'NEW SOS ALERT'}</Text>
        <View style={styles.list}>
          {ringing.map((s) => (
            <View key={s.key} style={styles.card}>
              <Text style={styles.type}>{typeLabel(s.type)}</Text>
              <Text style={styles.name}>{s.name}{s.place ? ` • ${s.place}` : ''}</Text>
              <Text style={styles.meta}>
                {[LEVEL[s.level], s.headcount ? `${s.headcount} ${s.headcount === 1 ? 'person' : 'people'}` : null, s.mine ? 'Assigned to your unit' : null]
                  .filter(Boolean).join(' • ')}
              </Text>
            </View>
          ))}
        </View>
        <TouchableOpacity style={styles.primary} onPress={open} accessibilityRole="button">
          <Text style={styles.primaryText}>Open SOS list</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={silence} accessibilityRole="button">
          <Text style={styles.secondaryText}>Silence alarm</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#B91C1C', alignItems: 'center', justifyContent: 'center', padding: 24 },
  siren: { fontSize: 64 },
  title: { color: '#FFF', fontSize: 28, fontWeight: '900', letterSpacing: 1, marginTop: 8, textAlign: 'center' },
  list: { alignSelf: 'stretch', gap: 10, marginVertical: 24 },
  card: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 12, padding: 14 },
  type: { color: '#FFF', fontSize: 18, fontWeight: '800' },
  name: { color: '#FFF', fontSize: 15, fontWeight: '600', marginTop: 4 },
  meta: { color: '#FEE2E2', fontSize: 13, marginTop: 4 },
  primary: { alignSelf: 'stretch', backgroundColor: '#FFF', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  primaryText: { color: '#B91C1C', fontSize: 17, fontWeight: '800' },
  secondary: { alignSelf: 'stretch', paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  secondaryText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});
