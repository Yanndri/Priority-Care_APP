import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Modal, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import BottomNav from '../../components/BottomNav';
import { useSession } from '../../components/SessionProvider';
import { EMERGENCY_TYPES } from '../../constants/mockData';
import { FONT_SIZES, FONT_WEIGHTS } from '../../constants/typography';
import {
  getMySos, raiseSos, cancelSos, getHouseholdStatus, setMemberMissing, getPublicMap, subscribe, onLiveSignal,
  getMyPreemptive, personBadge, MOBILITY_LABELS,
} from '../../services/api';
import DisasterBanner from '../../components/DisasterBanner';
import { getCurrentCoords, distanceMeters, formatDistance, shelterLoad } from '../../lib/location';

const clock = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
};

// Last loaded data, kept while the app runs. Switching tabs from another screen remounts this
// screen; starting from the cached state stops the "no emergency" view flashing before the reload.
let cache = { uid: null };

export default function ResidentDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { profile } = useSession();
  const cached = cache.uid != null && cache.uid === profile?.uid ? cache : null;
  const resident = profile?.resident || {};
  const fullName = [profile?.f_name, profile?.l_name].filter(Boolean).join(' ');
  const homeCoords = resident.gps_lat != null ? { lat: Number(resident.gps_lat), lng: Number(resident.gps_long) } : null;

  const [currentGps, setCurrentGps] = useState(null);
  const distFromHome = distanceMeters(currentGps, homeCoords);
  const isDisplaced = distFromHome != null && distFromHome > 150;

  const [activeTab, setActiveTab] = useState(params.tab || 'SOS');
  const [sos, setSos] = useState(cached?.sos ?? null);
  const [loaded, setLoaded] = useState(Boolean(cached));
  const [selectedEmergency, setSelectedEmergency] = useState(EMERGENCY_TYPES[0]);
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  const [people, setPeople] = useState(cached?.people ?? []);
  const [centers, setCenters] = useState(cached?.centers ?? []);
  const [events, setEvents] = useState(cached?.events ?? []);
  const [plan, setPlan] = useState(cached?.plan ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [lastSynced, setLastSynced] = useState('');

  const load = useCallback(async () => {
    try {
      const [mySos, household, map] = await Promise.all([getMySos(), getHouseholdStatus(), getPublicMap()]);
      setSos(mySos);
      setPeople(household?.people || []);
      setCenters(map?.centers || []);
      // Only declarations for the resident's own barangay.
      setEvents((map?.events || []).filter((e) => e.barangay_id === profile?.resident?.barangay_id));
      // Barangay shelter plan and the last pre-emptive report; optional, so a failure here is not "offline".
      getMyPreemptive().then(setPlan).catch(() => {});
      setIsOffline(false);
      setLoaded(true);
      setLastSynced(clock(new Date().toISOString()));
    } catch {
      setIsOffline(true);
    }
  }, [profile?.resident?.barangay_id]);

  useEffect(() => {
    if (loaded && profile?.uid) cache = { uid: profile.uid, sos, people, centers, events, plan };
  }, [loaded, profile?.uid, sos, people, centers, events, plan]);

  useEffect(() => {
    if (params.tab) setActiveTab(params.tab);
  }, [params.tab]);

  useEffect(() => {
    load();
    getCurrentCoords().then(setCurrentGps);
    // Live changes where row access allows it, plus a periodic refresh for the rest
    // (ticket and shelter updates the resident cannot subscribe to directly).
    const unsubscribe = subscribe(['sos_alerts', 'evacuation_records', 'hazard_reports'], load);
    // Changes made from the web console (declarations, centres, shelter plan, tickets, missing reports).
    const unsignal = onLiveSignal(['events', 'centers', 'shelter_plans', 'tickets', 'missing', 'preemptive'], load);
    const timer = setInterval(load, 20000);
    return () => { unsubscribe(); unsignal(); clearInterval(timer); };
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const sosActive = sos?.status === 'active';
  const sosType = EMERGENCY_TYPES.find((t) => t.id === sos?.alert_type) || selectedEmergency;

  const handleTriggerSOS = () => {
    Alert.alert(`Broadcast ${selectedEmergency.label} SOS?`, `Your location and ${people.length || 1} household member(s) will be sent to the MDRRMO.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'CONFIRM SOS',
        onPress: async () => {
          setBusy(true);
          try {
            const coords = await getCurrentCoords({ precise: true });
            setSos(await raiseSos(selectedEmergency.id, coords));
            if (!coords) Alert.alert('SOS sent', 'Location was not available, so your registered home location was sent instead.');
          } catch (e) {
            Alert.alert('SOS not sent', `${e.message}\n\nIf you cannot get through, call the MDRRMO hotline.`);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const handleConfirmCancelSOS = async (reason) => {
    setCancelModalVisible(false);
    setBusy(true);
    try {
      setSos(await cancelSos(reason));
      Alert.alert('Distress Call Cancelled ✅', 'MDRRMO responders have been told your household no longer needs rescue.');
    } catch (e) {
      Alert.alert('Could not cancel', e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleMissing = (person) => {
    if (person.kind !== 'member') return;
    const isMissing = person.missing;
    Alert.alert(isMissing ? 'Mark Safe?' : 'Report Missing?', `Update status for ${person.name} on the municipal register?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: isMissing ? 'Mark Safe' : 'Flag Missing',
        style: isMissing ? 'default' : 'destructive',
        onPress: async () => {
          try {
            await setMemberMissing(person.member_id, !isMissing);
            await load();
          } catch (e) {
            Alert.alert('Not updated', e.message);
          }
        },
      },
    ]);
  };

  // Shelter suggestion: nearest open centre to home, or to where the resident is now when away.
  const withDistance = (from) => centers
    .map((c) => ({ ...c, distance: distanceMeters(from, { lat: Number(c.latitude), lng: Number(c.longitude) }) }))
    .filter((c) => shelterLoad(c).label !== 'FULL')
    .sort((a, b) => (a.distance ?? 1e12) - (b.distance ?? 1e12));
  // The barangay's designated shelter (shelter plan) comes first while it has room.
  const designatedId = plan?.centers?.find((c) => c.is_primary)?.center_id;
  const designated = withDistance(homeCoords).find((c) => c.center_id === designatedId);
  const homeShelter = designated || withDistance(homeCoords)[0];
  const nearestShelter = withDistance(currentGps || homeCoords)[0];
  const suggested = isDisplaced ? nearestShelter : homeShelter;
  const sortedCenters = centers
    .map((c) => ({ ...c, distance: distanceMeters(currentGps || homeCoords, { lat: Number(c.latitude), lng: Number(c.longitude) }) }))
    .sort((a, b) => (a.distance ?? 1e12) - (b.distance ?? 1e12));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top Header */}
      <View style={styles.topHeader}>
        <View>
          <Text style={styles.headerSub}>HOUSEHOLD EMERGENCY PORTAL</Text>
          <Text style={styles.headerTitle}>{fullName || 'Resident'}</Text>
        </View>
        <View style={[styles.badgeVerified, !profile?.is_verified && styles.badgePending]}>
          <Text style={[styles.badgeVerifiedText, !profile?.is_verified && { color: '#B45309' }]}>
            {profile?.is_verified ? '✓ VERIFIED' : 'PENDING VERIFICATION'}
          </Text>
        </View>
      </View>

      {/* Active disaster declarations for the resident's barangay (live from the web console) */}
      <DisasterBanner events={events} />

      {/* Sync Status Strip */}
      <View style={[styles.syncStrip, isOffline ? styles.bgOffline : styles.bgOnline]}>
        <Text style={styles.syncText}>{isOffline ? '● OFFLINE • SHOWING LAST KNOWN DATA' : `● ONLINE • SYNCED ${lastSynced}`}</Text>
      </View>

      {activeTab === 'SOS' ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.tabContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* Summary & Evacuation Vector Bar */}
          <View style={styles.summaryBar}>
            <View style={styles.summaryCol}>
              <Text style={styles.label}>BARANGAY</Text>
              <Text style={styles.val}>{resident.barangay_name || '—'}</Text>
              <Text style={styles.sub}>{resident.sitio || ' '}</Text>
            </View>
            <View style={styles.vDivider} />
            <View style={styles.summaryCol}>
              <Text style={styles.label}>{isDisplaced ? 'NEAREST SHELTER' : designated ? 'YOUR SHELTER' : 'SHELTER NEAR HOME'}</Text>
              <Text style={[styles.val, { color: '#1E3A8A' }]} numberOfLines={1}>
                {suggested ? suggested.center_name : 'None open'}
              </Text>
              <Text style={styles.sub}>
                {isDisplaced ? `Away from home (${formatDistance(distFromHome)})` : suggested ? formatDistance(suggested.distance) : ' '}
              </Text>
            </View>
            <View style={styles.vDivider} />
            <TouchableOpacity style={styles.summaryCol} onPress={() => router.push('/(resident)/evac-map')}>
              <Text style={styles.label}>ROUTE MAP</Text>
              <Text style={[styles.sub, { color: '#2563EB', fontWeight: FONT_WEIGHTS.extraBold }]}>View Path →</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.evacReportBtn, events.length > 0 && styles.evacReportBtnUrgent]}
            onPress={() => router.push('/(resident)/evacuate')}
            accessibilityRole="button"
          >
            <Text style={[styles.evacReportText, events.length > 0 && { color: '#FFF' }]}>
              🏃 Tell your barangay where you are
            </Text>
            <Text style={[styles.evacReportSub, events.length > 0 && { color: '#DBEAFE' }]}>
              {plan?.latest ? `Last report: ${plan.latest.status.replace(/_/g, ' ')}` : 'Staying home, leaving, or arrived at a shelter'}
            </Text>
          </TouchableOpacity>

          {!loaded ? (
            <ActivityIndicator style={{ marginTop: 40 }} size="large" color="#DC2626" />
          ) : !sosActive ? (
            <>
              {sos && sos.app_status !== 'CANCELLED' && (
                <View style={[styles.card, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0', marginTop: 10 }]}>
                  <Text style={[styles.label, { color: '#15803D' }]}>LAST SOS • {clock(sos.created_at)}</Text>
                  <Text style={styles.val}>
                    {sos.app_status === 'EVACUATED' ? `Household admitted to ${sos.shelter}.` : 'Rescue completed and closed by the responders.'}
                  </Text>
                </View>
              )}
              {/* Emergency Selector Grid */}
              <View style={[styles.card, { marginTop: 10 }]}>
                <Text style={styles.label}>1. SELECT EMERGENCY TYPE</Text>
                <View style={styles.grid}>
                  {EMERGENCY_TYPES.map((t) => (
                    <TouchableOpacity
                      key={t.id}
                      style={[styles.pill, selectedEmergency.id === t.id && styles.pillActive]}
                      onPress={() => setSelectedEmergency(t)}
                    >
                      <Text style={{ fontSize: 14 }}>{t.icon}</Text>
                      <Text style={[styles.pillText, selectedEmergency.id === t.id && styles.pillTextActive]}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Large SOS Button */}
              <View style={styles.sosWrap}>
                <TouchableOpacity style={styles.sosButton} onPress={handleTriggerSOS} activeOpacity={0.85} disabled={busy}>
                  {busy ? <ActivityIndicator color="#FFF" size="large" /> : (
                    <>
                      <Text style={styles.sosIcon}>{selectedEmergency.icon}</Text>
                      <Text style={styles.sosLabel}>BROADCAST SOS</Text>
                      <Text style={styles.sosSub}>{selectedEmergency.label}</Text>
                    </>
                  )}
                </TouchableOpacity>
                <Text style={styles.sub}>Sends your location & household needs to the MDRRMO</Text>
              </View>
            </>
          ) : (
            /* Active Distress State with Cancel / Self-Evacuation Flow */
            <View style={[styles.activeSosCard, { marginTop: 10 }]}>
              <Text style={styles.activeSosTitle}>⚠️ {sosType.icon} {sosType.label.toUpperCase()} ACTIVE</Text>
              <Text style={styles.activeSosSub}>
                Broadcasted at {clock(sos.created_at)} • {sos.headcount} person(s) • Priority level {sos.alert_level}
              </Text>

              <View style={styles.trackerBox}>
                <Text style={styles.stepDone}>✓ 1. Distress logged & sent to the MDRRMO</Text>
                <Text style={sos.ticket ? styles.stepDone : styles.stepActive}>
                  {sos.ticket ? `✓ 2. ${sos.ticket.unit_name || 'Rescue team'} assigned (${sos.ticket.status.replace('_', ' ')})` : '● 2. Waiting for a rescue team to be assigned'}
                </Text>
                <Text style={sos.app_status === 'EVACUATED' ? styles.stepDone : styles.stepPending}>
                  {sos.app_status === 'EVACUATED' ? `✓ 3. Admitted to ${sos.shelter}` : '○ 3. Admitted to an evacuation centre'}
                </Text>
              </View>

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <TouchableOpacity style={styles.btnPrimary} onPress={() => router.push('/(resident)/evac-map')}>
                  <Text style={styles.btnPrimaryText}>🗺️ View Map</Text>
                </TouchableOpacity>
                {/* Cancel Distress / Self-Evacuation Button (Module 5.3) */}
                <TouchableOpacity style={styles.btnCancelDistress} onPress={() => setCancelModalVisible(true)} disabled={busy}>
                  <Text style={styles.btnCancelDistressText}>✕ Cancel SOS / Self-Evacuated</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      ) : (
        /* Shelters & Household Tab */
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 14 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <View style={[styles.card, { backgroundColor: isDisplaced ? '#FFFBEB' : '#EFF6FF', borderColor: isDisplaced ? '#FDE68A' : '#BFDBFE' }]}>
            <Text style={[styles.label, { color: isDisplaced ? '#B45309' : '#1E3A8A' }]}>
              {isDisplaced ? '🏃 AWAY FROM HOME NOTICE' : designated ? "★ YOUR BARANGAY'S DESIGNATED SHELTER" : '🏠 NEAREST OPEN SHELTER TO YOUR HOME'}
            </Text>
            <Text style={[styles.val, { fontSize: 13 }]}>
              {!suggested
                ? 'No evacuation centre is open right now.'
                : isDisplaced
                  ? `You are ${formatDistance(distFromHome)} from home. Proceed to the nearest shelter: ${suggested.center_name}`
                  : `${suggested.center_name} (${formatDistance(suggested.distance)})`}
            </Text>
          </View>

          {/* Household Roster */}
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={styles.label}>HOUSEHOLD ROSTER (TAP TO FLAG MISSING)</Text>
              <TouchableOpacity onPress={() => router.push('/(resident)/profile')}>
                <Text style={{ color: '#1E3A8A', fontWeight: FONT_WEIGHTS.extraBold, fontSize: FONT_SIZES.caption }}>+ Edit</Text>
              </TouchableOpacity>
            </View>
            {people.map((m) => {
              const badge = personBadge(m);
              return (
                <TouchableOpacity
                  key={m.member_id || m.uid}
                  style={styles.memberRow}
                  onPress={() => handleToggleMissing(m)}
                  disabled={m.kind !== 'member'}
                >
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.val}>{m.name}</Text>
                    <Text style={styles.sub}>
                      {[m.kind === 'resident' ? 'Account holder' : m.relationship, MOBILITY_LABELS[m.mobility], m.center_name]
                        .filter(Boolean).join(' • ')}
                    </Text>
                  </View>
                  <View style={[styles.badge, badge === 'MISSING' ? styles.bgDanger : styles.bgNeutral]}>
                    <Text style={[styles.badgeText, badge === 'MISSING' && { color: '#B91C1C' }]}>{badge}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.sectionHeader, { marginTop: 12 }]}>LIVE SHELTER CAPACITY</Text>
          {sortedCenters.length === 0 && <Text style={styles.sub}>No evacuation centre is open right now.</Text>}
          {sortedCenters.map((s) => {
            const occ = shelterLoad(s);
            return (
              <View key={s.center_id} style={styles.card}>
                <View style={styles.shelterHeaderRow}>
                  <Text style={styles.shelterTitle}>{s.center_name}</Text>
                  <Text style={[styles.shelterPercent, { color: occ.color }]}>
                    {occ.percent}% • {occ.label}
                  </Text>
                </View>
                <Text style={styles.sub}>
                  {s.distance != null ? `📍 ${formatDistance(s.distance)} • ` : ''}{s.occupied}/{s.capacity} Occupied ({Math.max(0, s.capacity - s.occupied)} Slots Left)
                </Text>
                <View style={styles.barBg}>
                  <View style={{ height: '100%', width: `${occ.percent}%`, backgroundColor: occ.color }} />
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Cancel Distress / Self-Evacuation Dialog Modal (Module 5.3) */}
      <Modal visible={cancelModalVisible} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>CANCEL ACTIVE SOS DISTRESS?</Text>
            <Text style={styles.dialogSub}>
              Select resolution reason to officially withdraw your extraction ticket:
            </Text>

            <View style={{ gap: 8, marginVertical: 12 }}>
              <TouchableOpacity style={styles.cancelReasonBtn} onPress={() => handleConfirmCancelSOS('self_evacuated')}>
                <Text style={styles.cancelReasonTitle}>🚶 Safely Self-Evacuated</Text>
                <Text style={styles.cancelReasonDesc}>Family reached safety or 2nd floor independently.</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelReasonBtn} onPress={() => handleConfirmCancelSOS('threat_receded')}>
                <Text style={styles.cancelReasonTitle}>🏡 Threat Receded / Safe at Home</Text>
                <Text style={styles.cancelReasonDesc}>Water level dropped; emergency assistance no longer required.</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelReasonBtn} onPress={() => handleConfirmCancelSOS('accidental')}>
                <Text style={[styles.cancelReasonTitle, { color: '#DC2626' }]}>⚠️ Accidental Trigger</Text>
                <Text style={styles.cancelReasonDesc}>Cancel without dispatch penalty.</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.btnKeepSos} onPress={() => setCancelModalVisible(false)}>
              <Text style={styles.btnKeepSosText}>Keep Distress Call Active</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  topHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, backgroundColor: '#FFF', borderBottomWidth: 1, borderColor: '#E2E8F0' },
  headerSub: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#64748B' },
  headerTitle: { fontSize: FONT_SIZES.title, fontWeight: FONT_WEIGHTS.black, color: '#0F172A' },

  evacReportBtn: { marginTop: 10, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14 },
  evacReportBtnUrgent: { backgroundColor: '#1D4ED8', borderColor: '#1D4ED8' },
  evacReportText: { fontSize: 16, fontWeight: '800', color: '#1D4ED8' },
  evacReportSub: { fontSize: 13, color: '#475569', marginTop: 2 },

  syncStrip: { paddingVertical: 4, paddingHorizontal: 14 },
  bgOnline: { backgroundColor: '#F0FDF4' },
  bgOffline: { backgroundColor: '#FEF2F2' },
  syncText: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#334155' },
  tabContent: { flexGrow: 1, padding: 14 },
  summaryBar: { flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center' },
  summaryCol: { flex: 1, alignItems: 'center' },
  vDivider: { width: 1, height: 28, backgroundColor: '#E2E8F0' },
  label: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#64748B', marginBottom: 4 },
  val: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.extraBold, color: '#0F172A' },
  sub: { fontSize: FONT_SIZES.tiny, color: '#64748B', marginTop: 1 },
  badgeVerified: { backgroundColor: '#DCFCE7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgePending: { backgroundColor: '#FEF3C7' },
  badgeVerifiedText: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.black, color: '#15803D' },
  card: { backgroundColor: '#FFF', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, padding: 8, borderRadius: 6, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', width: '48.5%' },
  pillActive: { backgroundColor: '#FEF2F2', borderColor: '#DC2626' },
  pillText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#475569' },
  pillTextActive: { color: '#DC2626', fontWeight: FONT_WEIGHTS.extraBold },
  sosWrap: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  sosIcon: { fontSize: FONT_SIZES.display },
  sosButton: { width: 175, height: 175, borderRadius: 88, backgroundColor: '#DC2626', alignItems: 'center', justifyContent: 'center', elevation: 8, borderWidth: 4, borderColor: '#FEE2E2', marginBottom: 8 },
  sosLabel: { fontSize: FONT_SIZES.subtitle, fontWeight: FONT_WEIGHTS.black, color: '#FFF', marginTop: 4 },
  sosSub: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#FEE2E2' },
  activeSosCard: { backgroundColor: '#FEF2F2', padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#FECACA' },
  activeSosTitle: { fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.black, color: '#B91C1C', textAlign: 'center' },
  activeSosSub: { fontSize: FONT_SIZES.caption, color: '#7F1D1D', textAlign: 'center', marginTop: 2, fontWeight: FONT_WEIGHTS.bold },
  trackerBox: { backgroundColor: '#FFF', borderRadius: 8, padding: 10, marginVertical: 10, gap: 6 },
  stepDone: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#16A34A' },
  stepActive: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#D97706' },
  stepPending: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.medium, color: '#94A3B8' },
  btnPrimary: { flex: 1, backgroundColor: '#1E3A8A', paddingVertical: 10, borderRadius: 6, alignItems: 'center' },
  btnPrimaryText: { color: '#FFF', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold },
  btnCancelDistress: { flex: 1, backgroundColor: '#FFF', borderWidth: 1.5, borderColor: '#DC2626', paddingVertical: 10, borderRadius: 6, alignItems: 'center' },
  btnCancelDistressText: { color: '#DC2626', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.black },
  sectionHeader: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.black, color: '#0F172A', marginBottom: 8 },
  searchInput: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 8, fontSize: FONT_SIZES.body, marginBottom: 8 },
  searchRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#EFF6FF', padding: 8, borderRadius: 6, marginBottom: 6 },
  memberRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderColor: '#F1F5F9' },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, flexShrink: 0 },
  bgDanger: { backgroundColor: '#FEE2E2' },
  bgNeutral: { backgroundColor: '#F1F5F9' },
  badgeText: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#475569' },

  shelterHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  shelterTitle: { flex: 1, fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.extraBold, color: '#0F172A' },
  shelterPercent: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, flexShrink: 0 },
  barBg: { height: 6, backgroundColor: '#E2E8F0', borderRadius: 3, overflow: 'hidden', marginTop: 6 },

  modalBg: { flex: 1, backgroundColor: 'rgba(15,23,42,0.7)', justifyContent: 'center', padding: 18 },
  dialog: { backgroundColor: '#FFF', borderRadius: 12, padding: 16 },
  dialogTitle: { fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.black, color: '#DC2626' },
  dialogSub: { fontSize: FONT_SIZES.caption, color: '#475569', marginTop: 4 },
  cancelReasonBtn: { padding: 10, borderRadius: 8, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1' },
  cancelReasonTitle: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.black, color: '#0F172A' },
  cancelReasonDesc: { fontSize: FONT_SIZES.tiny, color: '#64748B', marginTop: 2 },
  btnKeepSos: { backgroundColor: '#1E3A8A', paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  btnKeepSosText: { color: '#FFF', fontWeight: FONT_WEIGHTS.extraBold, fontSize: FONT_SIZES.caption },
});