// Resident Hazards screen: what to avoid near you, and what happened to the hazards you reported.
// Read-only for others' reports (residents only see hazards a responder or the MDRRMO confirmed).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import BottomNav from '../../components/BottomNav';
import DisastersPanel from '../../components/DisastersPanel';
import { useActiveDisasters } from '../../components/DisasterBanner';
import { useSession } from '../../components/SessionProvider';
import { FONT_SIZES, FONT_WEIGHTS } from '../../constants/typography';
import { HAZARD_OPTIONS } from '../../constants/options';
import { confirmHazard, getMyHazardReports, getNearbyHazards, getPublicMap, subscribe, unconfirmHazard, withdrawMyHazard } from '../../services/api';
import { distanceMeters, formatDistance } from '../../lib/location';
import { getDemoSpot, getSharedLocation } from '../../lib/sharedLocation';
import { toMapHazard } from '../../lib/mapData';
import { timeAgo } from '../../lib/rescuerFeed';

const TYPE_LABEL = Object.fromEntries(HAZARD_OPTIONS.map((h) => [h.id, h.label]));

const MY_STATUS = {
  unverified: { text: '⏳ WAITING TO BE CHECKED', style: 'amber' },
  under_review: { text: '⏳ BEING CHECKED', style: 'amber' },
  confirmed: { text: '✓ CONFIRMED', style: 'green' },
  resolved: { text: '✓ CLEARED', style: 'grey' },
  dismissed: { text: '✕ FALSE REPORT', style: 'grey' },
};

export default function ResidentHazardsScreen() {
  const insets = useSafeAreaInsets();
  // Top switch: hazard reports, or declared disasters (now + past).
  const [view, setView] = useState('HAZARDS');
  const router = useRouter();
  const { profile } = useSession();
  const resident = profile?.resident || {};
  const barangayId = resident.barangay_id ?? null;
  const { events } = useActiveDisasters({ barangayId, enabled: barangayId != null });

  const [tab, setTab] = useState('CONFIRMED');
  const [hazards, setHazards] = useState([]);
  const [mine, setMine] = useState([]);
  // My reports: the 3 latest at first; "Show more" loads 10 more.
  const [mineLimit, setMineLimit] = useState(3);
  const [mineMore, setMineMore] = useState(false);
  // Reports near you that nobody has confirmed yet (last 6 hours, within 1 km): you can still say
  // "I see it too" here, even if you pressed "Not sure" on the pop-up.
  const [toCheck, setToCheck] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const homeSpot = resident.gps_lat != null ? { lat: Number(resident.gps_lat), lng: Number(resident.gps_long) } : null;
  const load = useCallback(async () => {
    try {
      const spot = getSharedLocation() || getDemoSpot() || homeSpot;
      const [map, own, near] = await Promise.all([
        getPublicMap(),
        getMyHazardReports(mineLimit + 1),
        spot ? getNearbyHazards(spot).catch(() => []) : Promise.resolve([]),
      ]);
      setHazards((map?.hazards || []).map(toMapHazard));
      setMine(own.slice(0, mineLimit).map(toMapHazard));
      setMineMore(own.length > mineLimit);
      setToCheck((near || []).filter((h) => h.status !== 'confirmed').map((h) => ({
        ...toMapHazard(h), distance: h.distance_m, confirmedByMe: h.confirmed_by_me, spot,
      })));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [homeSpot?.lat, homeSpot?.lng, mineLimit]);

  const answer = async (h, yes) => {
    try {
      if (yes) await confirmHazard(h.id, h.spot);
      else await unconfirmHazard(h.id);
      await load();
    } catch (e) {
      Alert.alert('Not sent', e.message);
    }
  };

  useEffect(() => {
    load();
    const unsubscribe = subscribe(['hazard_reports'], load);
    const timer = setInterval(load, 30000);
    return () => { unsubscribe(); clearInterval(timer); };
  }, [load]);

  // Distance from where the map last put you (phone GPS or demo spot), else your home.
  const here = getSharedLocation() || getDemoSpot()
    || (resident.gps_lat != null ? { lat: Number(resident.gps_lat), lng: Number(resident.gps_long) } : null);
  const nearby = useMemo(() => hazards
    .map((h) => ({ ...h, distance: here ? distanceMeters(here, h) : null }))
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity)),
  [hazards, here?.lat, here?.lng]);

  const showOnMap = (h) => router.push({
    pathname: '/(resident)/evac-map',
    params: {
      focusHazardTs: String(Date.now()),
      focusHazardId: String(h.id),
      focusHazardLat: String(h.lat),
      focusHazardLng: String(h.lng),
    },
  });

  const takeBack = (h) => Alert.alert(
    'Take back this report?',
    'Use this if you pinned it by mistake or it was not really a hazard. It will be removed from the map.',
    [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Take it back',
        style: 'destructive',
        onPress: async () => {
          try { await withdrawMyHazard(h.id); await load(); } catch (e) { Alert.alert('Could not take it back', e.message); }
        },
      },
    ]
  );

  const reportHazard = () => router.push({ pathname: '/(resident)/evac-map', params: { reportHazardTs: String(Date.now()) } });

  const list = tab === 'CONFIRMED' ? nearby : tab === 'UNCONFIRMED' ? toCheck : mine;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { flex: 1 }]}>Hazards</Text>
        <TouchableOpacity style={styles.btnReport} onPress={reportHazard} accessibilityRole="button">
          <Text style={styles.btnReportText}>🚨 REPORT HAZARD</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.segment} accessibilityRole="tablist">
        {[['HAZARDS', 'Hazards'], ['DISASTERS', 'Disasters']].map(([key, text]) => (
          <TouchableOpacity key={key} style={[styles.segBtn, view === key && styles.segBtnActive]} onPress={() => setView(key)} accessibilityRole="tab" accessibilityState={{ selected: view === key }}>
            <Text style={[styles.segText, view === key && styles.segTextActive]}>
              {text}{key === 'DISASTERS' && events.length > 0 ? <Text style={styles.segDot}> ● {events.length}</Text> : null}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {view === 'DISASTERS' ? <DisastersPanel events={events} barangayId={barangayId} /> : (
        <>
      <View style={styles.filterRow}>
        {[['CONFIRMED', 'Confirmed'], ['UNCONFIRMED', `Unconfirmed${toCheck.length ? ` (${toCheck.length})` : ''}`], ['MINE', 'My reports']].map(([key, text]) => (
          <TouchableOpacity key={key} style={[styles.chip, tab === key && styles.chipActive]} onPress={() => setTab(key)}>
            <Text style={[styles.chipText, tab === key && styles.chipTextActive]}>{text}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={list}
        refreshing={loading}
        onRefresh={load}
        keyExtractor={(h) => String(h.id)}
        contentContainerStyle={{ padding: 14, gap: 10 }}
        ListFooterComponent={tab === 'MINE' && mineMore ? (
          <TouchableOpacity style={styles.btnMore} onPress={() => setMineLimit((n) => n + 10)} accessibilityRole="button">
            <Text style={styles.btnMoreText}>Show more</Text>
          </TouchableOpacity>
        ) : null}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {error ? `Could not load hazards: ${error}`
              : tab === 'CONFIRMED' ? 'No confirmed hazards right now.'
              : tab === 'UNCONFIRMED' ? 'No unchecked reports within 1 km of you in the last 6 hours.'
              : 'You have not reported any hazards yet.'}
          </Text>
        }
        renderItem={({ item }) => {
          const status = MY_STATUS[item.status] || MY_STATUS.unverified;
          const closed = item.status === 'resolved' || item.status === 'dismissed';
          return (
            <TouchableOpacity
              style={[styles.card, tab === 'UNCONFIRMED' && styles.cardCheck, tab === 'MINE' && closed && styles.cardClosed]}
              activeOpacity={0.85}
              onPress={() => { if (!closed) showOnMap(item); }}
            >
              <View style={styles.topRow}>
                <Text style={styles.cardTitle}>{item.icon} {TYPE_LABEL[item.type] || 'Hazard'}</Text>
                {tab !== 'MINE'
                  ? item.distance != null && <Text style={styles.distance}>{formatDistance(item.distance)} away</Text>
                  : (
                    <View style={[styles.badge, styles[`badge_${status.style}`]]}>
                      <Text style={[styles.badgeText, styles[`badgeText_${status.style}`]]}>{status.text}</Text>
                    </View>
                  )}
              </View>
              {item.eventId && (
                <View style={styles.eventTag}>
                  <Text style={styles.eventTagText}>
                    🚨 Part of the declared disaster{events.find((e) => e.event_id === item.eventId) ? `: ${events.find((e) => e.event_id === item.eventId).name}` : ''}
                  </Text>
                </View>
              )}
              {!!item.description && <Text style={styles.desc}>{item.description}</Text>}
              <View style={styles.metaRow}>
                <Text style={styles.meta}>
                  {timeAgo(item.createdAt)}
                  {tab === 'MINE' && item.reviewNote ? `\nNote: ${item.reviewNote}` : ''}
                </Text>
              </View>
              {tab === 'UNCONFIRMED' && (item.confirmedByMe ? (
                <View>
                  <Text style={[styles.saidYes, { marginTop: 10 }]}>✓ You said you see it</Text>
                  <TouchableOpacity style={styles.btnTakeBack} onPress={() => answer(item, false)} accessibilityRole="button">
                    <Text style={styles.btnTakeBackText}>↩ Take it back</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.btnSeeIt} onPress={() => answer(item, true)} accessibilityRole="button">
                  <Text style={styles.btnSeeItText}>👁 I see it too</Text>
                </TouchableOpacity>
              ))}
              {tab === 'MINE' && (item.status === 'unverified' || item.status === 'under_review') && !item.eventId && (
                <TouchableOpacity style={styles.btnTakeBack} onPress={() => takeBack(item)} accessibilityRole="button">
                  <Text style={styles.btnTakeBackText}>↩ Take it back (sent by mistake)</Text>
                </TouchableOpacity>
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
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, backgroundColor: '#FFF', borderBottomWidth: 1, borderColor: '#E2E8F0' },
  sub: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#64748B' },
  title: { fontSize: FONT_SIZES.title, fontWeight: FONT_WEIGHTS.black, color: '#0F172A' },
  btnReport: { backgroundColor: '#DC2626', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  btnReportText: { color: '#FFF', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold },

  filterRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#FFF' },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: '#F1F5F9' },
  chipActive: { backgroundColor: '#1E3A8A' },
  chipText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#64748B' },
  chipTextActive: { color: '#FFF', fontWeight: FONT_WEIGHTS.extraBold },

  empty: { textAlign: 'center', color: '#64748B', marginTop: 24 },
  card: { backgroundColor: '#FEF2F2', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#FECACA' },
  cardClosed: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  cardTitle: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.black, color: '#0F172A', flex: 1 },
  distance: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#B91C1C' },
  desc: { fontSize: FONT_SIZES.caption, color: '#334155', marginTop: 6 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  meta: { fontSize: FONT_SIZES.tiny, color: '#64748B', fontWeight: FONT_WEIGHTS.bold, flex: 1, paddingRight: 8 },

  eventTag: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: '#B91C1C' },
  eventTagText: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#FFF' },
  btnTakeBack: { marginTop: 10, paddingVertical: 11, borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center', backgroundColor: '#FFF' },
  btnTakeBackText: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.extraBold, color: '#334155' },
  cardCheck: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  saidYes: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#16A34A' },
  btnSeeIt: { marginTop: 10, paddingVertical: 9, borderRadius: 8, backgroundColor: '#D97706', alignItems: 'center' },
  btnSeeItText: { color: '#FFF', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  badge_amber: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  badge_green: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  badge_grey: { backgroundColor: '#F1F5F9', borderColor: '#CBD5E1' },
  badgeText: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold },
  badgeText_amber: { color: '#D97706' },
  badgeText_green: { color: '#16A34A' },
  badgeText_grey: { color: '#475569' },
});
