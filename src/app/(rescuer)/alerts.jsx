import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import BottomNav from '../../components/BottomNav';
import DisastersPanel from '../../components/DisastersPanel';
import { FONT_SIZES, FONT_WEIGHTS } from '../../constants/typography';
import { timeAgo, useRescuerFeed } from '../../lib/rescuerFeed';
import { toMapHazard } from '../../lib/mapData';
import { alarmLabel, getHazardAlarms, getHazardHistory, getHazardReporters, reporterLabel, reviewHazard } from '../../services/api';

export default function RescuerAlertsScreen() {
  const insets = useSafeAreaInsets();
  // Top switch: hazard reports, or declared disasters (now + past).
  const [view, setView] = useState('HAZARDS');
  const router = useRouter();
  const [filter, setFilter] = useState('ALL');
  const feed = useRescuerFeed();
  const hazards = feed.hazards;
  // Alarm level per hazard: 2nd / 3rd alarm when people nearby confirmed it or reported the same thing.
  const [alarms, setAlarms] = useState({});
  useEffect(() => {
    let alive = true;
    getHazardAlarms()
      .then((rows) => { if (alive) setAlarms(Object.fromEntries((rows || []).map((a) => [a.hazard_id, a]))); })
      .catch(() => { /* STEP20 not run yet: no alarm levels */ });
    return () => { alive = false; };
  }, [feed.syncedAt]);

  // History: reports that were resolved or marked false (loaded only when the chip is picked).
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState(null);
  // Only the 3 latest at first; "Show more" loads 10 more (saves data when switching screens often).
  const [historyLimit, setHistoryLimit] = useState(3);
  const [historyMore, setHistoryMore] = useState(false);
  useEffect(() => {
    if (filter !== 'HISTORY') return undefined;
    let alive = true;
    getHazardHistory(historyLimit + 1)
      .then(async (all) => {
        const rows = all.slice(0, historyLimit);
        if (alive) setHistoryMore(all.length > historyLimit);
        const reporters = await getHazardReporters(rows.map((h) => h.hazard_id));
        if (!alive) return;
        setHistoryError(null);
        setHistory(rows.map((h) => ({
          ...toMapHazard(h),
          barangay: feed.barangayNames?.[h.barangay_id] || '',
          reportedBy: reporterLabel(h.reporter_role, reporters[h.hazard_id]),
          time: timeAgo(h.created_at),
        })));
      })
      .catch((e) => { if (alive) setHistoryError(e.message); });
    return () => { alive = false; };
  }, [filter, historyLimit, feed.syncedAt, feed.barangayNames]);

  const filteredHazards = filter === 'HISTORY' ? history : hazards.filter((h) => {
    if (filter === 'UNVERIFIED') return h.status === 'unverified' || h.status === 'under_review';
    if (filter === 'CONFIRMED') return h.status === 'confirmed';
    return true;
  });

  const handleLocateHazardOnMap = (hazard) => {
    router.push({
      pathname: '/(rescuer)/map',
      params: { focusHazardId: hazard.id, focusTs: String(Date.now()) },
    });
  };

  // Every answer can be undone right away (back to "being checked"), in case of a misclick.
  const act = async (id, action, note, done) => {
    try {
      await reviewHazard(id, action, note);
      await feed.reload();
      const undo = { text: 'Undo', onPress: () => act(id, 'review', 'Responder undid their answer') };
      if (done) Alert.alert(done[0], done[1], [undo, { text: 'OK' }]);
      else if (action === 'dismiss') Alert.alert('Marked as false', 'Taken off the map.', [undo, { text: 'OK' }]);
    } catch (e) {
      Alert.alert('Not saved', e.message);
    }
  };

  const handleVerifyHazard = (id) => act(id, 'confirm', 'Confirmed by a responder',
    ['Hazard confirmed ✅', 'It now shows as confirmed on every map.']);

  const handleDismissHazard = (id) => {
    Alert.alert('Mark as false report? 🚫', 'Only do this if you checked the place yourself and found nothing.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'No, false report',
        style: 'destructive',
        onPress: () => act(id, 'dismiss', 'False report: checked on site, no hazard found'),
      },
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Hazards</Text>
      </View>
      <View style={styles.segment} accessibilityRole="tablist">
        {[['HAZARDS', 'Hazards'], ['DISASTERS', 'Disasters']].map(([key, text]) => (
          <TouchableOpacity key={key} style={[styles.segBtn, view === key && styles.segBtnActive]} onPress={() => setView(key)} accessibilityRole="tab" accessibilityState={{ selected: view === key }}>
            <Text style={[styles.segText, view === key && styles.segTextActive]}>
              {text}{key === 'DISASTERS' && feed.events.length > 0 ? <Text style={styles.segDot}> ● {feed.events.length}</Text> : null}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {view === 'DISASTERS' ? <DisastersPanel events={feed.events} /> : (
        <>
      {/* Filter Chips */}
      <View style={styles.filterRow}>
        {['ALL', 'UNVERIFIED', 'CONFIRMED', 'HISTORY'].map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.chip, filter === f && styles.chipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filteredHazards}
        refreshing={feed.loading}
        onRefresh={feed.reload}
        ListFooterComponent={filter === 'HISTORY' && historyMore ? (
          <TouchableOpacity style={styles.btnMore} onPress={() => setHistoryLimit((n) => n + 10)} accessibilityRole="button">
            <Text style={styles.btnMoreText}>Show more</Text>
          </TouchableOpacity>
        ) : null}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: '#64748B', marginTop: 24 }}>
            {filter === 'HISTORY'
              ? (historyError ? `Could not load history: ${historyError}` : 'No closed hazard reports yet.')
              : feed.error ? `Could not load hazards: ${feed.error}` : 'No open hazard reports in the last 7 days.'}
          </Text>
        }
        keyExtractor={(h) => h.id}
        contentContainerStyle={{ padding: 14, gap: 10 }}
        renderItem={({ item }) => {
          const isConfirmed = item.status === 'confirmed';
          const isReview = item.status === 'under_review';
          const isClosed = item.status === 'resolved' || item.status === 'dismissed';
          return (
            <TouchableOpacity
              style={[styles.hazardCard, isConfirmed && styles.hazardCardConfirmed, isClosed && styles.hazardCardClosed]}
              activeOpacity={0.85}
              onPress={() => { if (!isClosed) handleLocateHazardOnMap(item); }}
            >
              <View style={styles.topRow}>
                <Text style={styles.hazardTitle}>
                  {item.icon} {item.type} • Brgy. {item.barangay}
                </Text>
                <View style={[styles.badge, isClosed ? styles.badgeGrey : isConfirmed ? styles.badgeGreen : styles.badgeAmber]}>
                  <Text style={[styles.badgeText, isClosed ? styles.badgeTextGrey : isConfirmed ? styles.badgeTextGreen : styles.badgeTextAmber]}>
                    {item.status === 'resolved' ? '✓ CLEARED' : item.status === 'dismissed' ? '✕ FALSE REPORT' : isConfirmed ? '✓ CONFIRMED' : isReview ? '⏳ BEING CHECKED' : '⚠️ UNVERIFIED'}
                  </Text>
                </View>
              </View>

              {!isClosed && alarms[item.id] && (
                <View style={[styles.alarmPill, alarms[item.id].alarm_level >= 3 ? styles.alarm3 : alarms[item.id].alarm_level === 2 ? styles.alarm2 : null]}>
                  <Text style={[styles.alarmText, alarms[item.id].alarm_level >= 2 && { color: '#FFF' }]}>
                    🔔 {alarmLabel(alarms[item.id].alarm_level)}
                    {alarms[item.id].alarm_level >= 2
                      ? ` • ${alarms[item.id].confirmations} saw it, ${alarms[item.id].nearby_reports} other reports nearby`
                      : ''}
                  </Text>
                </View>
              )}

              {item.eventId && (
                <View style={styles.eventTag}>
                  <Text style={styles.eventTagText}>
                    🚨 Part of the declared disaster{feed.events.find((e) => e.event_id === item.eventId) ? `: ${feed.events.find((e) => e.event_id === item.eventId).name}` : ''}
                  </Text>
                </View>
              )}

              <Text style={styles.hazardDesc}>{item.description}</Text>

              <View style={styles.metaRow}>
                <Text style={styles.hazardMeta}>
                  Reported by {item.reportedBy} • {item.time}
                  {item.reviewNote ? `\n✓ Note: ${item.reviewNote}` : ''}
                </Text>
                {!isClosed && (
                  <View style={styles.locatePill}>
                    <Text style={styles.locatePillText}>📍 SHOW ON MAP</Text>
                  </View>
                )}
              </View>

              {(isConfirmed || isClosed) && !item.eventId && (
                <TouchableOpacity
                  style={styles.btnUndo}
                  accessibilityRole="button"
                  onPress={() => Alert.alert(
                    'Undo your answer? ↩️',
                    isClosed ? 'This puts the report back on the map as not checked yet.' : 'This marks the report as not checked yet.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Undo', onPress: () => act(item.id, 'review', 'Responder undid the answer (back to not checked)') },
                    ],
                  )}
                >
                  <Text style={styles.btnUndoText}>↩️ Undo (back to not checked)</Text>
                </TouchableOpacity>
              )}

              {!isConfirmed && !isClosed && (
                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.btnVerify} onPress={() => handleVerifyHazard(item.id)}>
                    <Text style={styles.btnVerifyText}>✓ Yes, it's real</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnDismiss} onPress={() => handleDismissHazard(item.id)}>
                    <Text style={styles.btnDismissText}>✕ No, false report</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
        </>
      )}
      <BottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  btnMore: { marginTop: 4, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFF', alignItems: 'center' },
  btnMoreText: { fontSize: 14, fontWeight: '800', color: '#1E3A8A' },
  segment: { flexDirection: 'row', marginHorizontal: 14, marginTop: 10, backgroundColor: '#E2E8F0', borderRadius: 10, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segBtnActive: { backgroundColor: '#FFF', elevation: 2 },
  segText: { fontSize: 14, fontWeight: '800', color: '#64748B' },
  segTextActive: { color: '#0F172A' },
  segDot: { color: '#DC2626' },
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, backgroundColor: '#FFF', borderBottomWidth: 1, borderColor: '#E2E8F0' },
  sub: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#64748B' },
  title: { fontSize: FONT_SIZES.title, fontWeight: FONT_WEIGHTS.black, color: '#0F172A' },

  filterRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#FFF' },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, backgroundColor: '#F1F5F9' },
  chipActive: { backgroundColor: '#1E3A8A' },
  chipText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#64748B' },
  chipTextActive: { color: '#FFF', fontWeight: FONT_WEIGHTS.extraBold },

  hazardCard: { backgroundColor: '#FFFBEB', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#FDE68A' },
  hazardCardClosed: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' },
  hazardCardConfirmed: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hazardTitle: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.black, color: '#0F172A', flex: 1, paddingRight: 6 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  badgeAmber: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  badgeGrey: { backgroundColor: '#F1F5F9', borderColor: '#CBD5E1' },
  badgeTextGrey: { color: '#475569' },
  badgeGreen: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  badgeText: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold },
  badgeTextAmber: { color: '#D97706' },
  badgeTextGreen: { color: '#16A34A' },

  hazardDesc: { fontSize: FONT_SIZES.caption, color: '#334155', marginTop: 6 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  hazardMeta: { fontSize: FONT_SIZES.tiny, color: '#64748B', fontWeight: FONT_WEIGHTS.bold, flex: 1, paddingRight: 8 },
  locatePill: { backgroundColor: '#1E3A8A', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  locatePillText: { color: '#FFF', fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold },

  actionRow: { flexDirection: 'row', gap: 6, marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderColor: '#FDE68A' },
  btnVerify: { flex: 1, backgroundColor: '#16A34A', paddingVertical: 7, borderRadius: 6, alignItems: 'center' },
  btnVerifyText: { color: '#FFF', fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold },
  eventTag: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: '#B91C1C' },
  eventTagText: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#FFF' },
  btnUndo: { marginTop: 10, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFF', alignItems: 'center' },
  btnUndoText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#334155' },
  alarmPill: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: '#E2E8F0' },
  alarm2: { backgroundColor: '#EA580C' },
  alarm3: { backgroundColor: '#DC2626' },
  alarmText: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#334155' },
  btnDismiss: { flex: 1, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CBD5E1', paddingVertical: 7, borderRadius: 6, alignItems: 'center' },
  btnDismissText: { color: '#DC2626', fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold },
});