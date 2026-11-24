// "Disasters" side of the Hazards screens: the disasters declared right now (with Show on map),
// then past disasters with when they ran and why they ended. Replaces the red banner.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useShowDisasterOnMap } from './DisasterBanner';
import { getDisasterHistory } from '../services/api';
import { splitEndReason } from '../utils/disasterAdvice';

const HAZARD_ICON = { flood: '🌊', fire: '🔥', landslide: '⛰️', storm: '🌀', typhoon: '🌀', earthquake: '🌐', storm_surge: '🌊' };
const typeLabel = (t) => (t ? t.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Disaster');
const day = (iso) => (iso ? new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export default function DisastersPanel({ events = [], barangayId = null }) {
  const showOnMap = useShowDisasterOnMap();
  const [past, setPast] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Past disasters: the 3 latest at first; "Show more" loads 10 more.
  const [limit, setLimit] = useState(3);
  const [more, setMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = (await getDisasterHistory(limit + 1)) || [];
      const mine = barangayId == null ? rows : rows.filter((e) => e.barangay_id === barangayId);
      setPast(mine.slice(0, limit));
      setMore(rows.length > limit);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [barangayId, limit]);
  useEffect(() => { load(); }, [load, events.length]);

  const rows = [
    { key: 'h-active', header: `DECLARED NOW (${events.length})` },
    ...(events.length ? events.map((e) => ({ key: `a-${e.event_id}`, active: e })) : [{ key: 'none-active', empty: 'No disaster is declared right now.' }]),
    { key: 'h-past', header: 'PAST DISASTERS' },
    ...(past.length ? past.map((e) => ({ key: `p-${e.event_id}`, past: e }))
      : [{ key: 'none-past', empty: error ? `Could not load past disasters: ${error}` : loading ? 'Loading…' : 'No past disasters yet.' }]),
    ...(more ? [{ key: 'more', more: true }] : []),
  ];

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.key}
      refreshing={loading}
      onRefresh={load}
      contentContainerStyle={{ padding: 14, gap: 10 }}
      renderItem={({ item }) => {
        if (item.header) return <Text style={styles.header}>{item.header}</Text>;
        if (item.empty) return <Text style={styles.empty}>{item.empty}</Text>;
        if (item.more) {
          return (
            <TouchableOpacity style={styles.btnMore} onPress={() => setLimit((n) => n + 10)} accessibilityRole="button">
              <Text style={styles.btnMoreText}>Show more past disasters</Text>
            </TouchableOpacity>
          );
        }
        if (item.active) {
          const e = item.active;
          return (
            <View style={[styles.card, styles.cardActive]}>
              <Text style={styles.title}>{HAZARD_ICON[e.hazard_type] || '⚠️'} {typeLabel(e.hazard_type)}: {e.name}</Text>
              <Text style={styles.sub}>Brgy. {e.barangay_name}{e.location_description ? ` • ${e.location_description}` : ''}</Text>
              <Text style={styles.meta}>Since {day(e.started_at)}</Text>
              <TouchableOpacity style={styles.btnMap} onPress={() => showOnMap(e)} accessibilityRole="button">
                <Text style={styles.btnMapText}>📍 Show on map</Text>
              </TouchableOpacity>
            </View>
          );
        }
        const e = item.past;
        return (
          <View style={[styles.card, styles.cardPast]}>
            <Text style={styles.title}>{HAZARD_ICON[e.hazard_type] || '⚠️'} {typeLabel(e.hazard_type)}: {e.name}</Text>
            <Text style={styles.sub}>Brgy. {e.barangay_name}{e.location_description ? ` • ${e.location_description}` : ''}</Text>
            <Text style={styles.meta}>{day(e.started_at)} – {day(e.resolved_at)}</Text>
            {(() => { const { advice, reason } = splitEndReason(e.resolution_reason); return <>
              {!!advice && <Text style={styles.advice}>Advice: {advice}</Text>}
              {!!reason && <Text style={styles.reason}>Ended: {reason}</Text>}
            </>; })()}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  advice: { fontSize: 14, fontWeight: '900', color: '#15803D', marginTop: 6 },
  btnMore: { marginTop: 4, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFF', alignItems: 'center' },
  btnMoreText: { fontSize: 14, fontWeight: '800', color: '#1E3A8A' },
  header: { fontSize: 12, fontWeight: '800', color: '#64748B', marginTop: 4 },
  empty: { color: '#64748B', fontSize: 14 },
  card: { padding: 14, borderRadius: 12, borderWidth: 1 },
  cardActive: { backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderLeftWidth: 5, borderLeftColor: '#B91C1C' },
  cardPast: { backgroundColor: '#FFF', borderColor: '#E2E8F0' },
  title: { fontSize: 15, fontWeight: '900', color: '#0F172A' },
  sub: { fontSize: 13, color: '#334155', marginTop: 4 },
  meta: { fontSize: 12, color: '#64748B', fontWeight: '700', marginTop: 4 },
  reason: { fontSize: 12, color: '#475569', marginTop: 4 },
  btnMap: { marginTop: 10, backgroundColor: '#B91C1C', borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  btnMapText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
});
