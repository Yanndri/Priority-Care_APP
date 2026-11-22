import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Modal, ActivityIndicator, RefreshControl, TextInput } from 'react-native';
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
import AtCentreCard from '../../components/AtCentreCard';
import { useMyRescue, RescueStatusCard } from '../../components/RescueWatcher';
import { getCurrentCoords, distanceMeters, formatDistance, shelterLoad } from '../../lib/location';
import { useCenterAvailability } from '../../lib/centerAvailability';

const clock = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
};

// Last loaded data, kept while the app runs. Switching tabs from another screen remounts this
// screen; starting from the cached state stops the "no emergency" view flashing before the reload.
let cache = { uid: null };

// Quick taps for a panicking resident, matched to the emergency (the type itself is already sent).
// Situations only, no illnesses (scope rule).
const NOTE_HINTS = {
  FLOOD: ['Water above the knee', 'Water above the waist', 'We are on the roof', 'Someone cannot walk', 'Children with us', 'Senior with us'],
  FIRE: ['Fire is spreading', 'Smoke inside the house', 'Someone has burns', 'Someone cannot walk', 'Children with us', 'Senior with us'],
  MEDICAL: ['Unconscious', 'Heavy bleeding', 'Hard to breathe', 'In labor', 'Cannot walk', 'Senior'],
  TRAPPED: ['Under debris', 'Door or way out blocked', 'Someone is injured', 'Someone cannot walk', 'Children with us', 'Senior with us'],
};

export default function ResidentDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { profile } = useSession();
  const rescue = useMyRescue();
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
  // Optional note so the MDRRMO knows what to bring (water level, who can't walk, injuries).
  // Optional details, asked on the confirm sheet after SEND SOS (tap chips and/or type).
  const [sosNote, setSosNote] = useState('');
  const [sosChips, setSosChips] = useState([]);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [sosWith, setSosWith] = useState([]); // member_ids of household members with the resident
  const [sosOthers, setSosOthers] = useState(0); // people with them who are not in the household
  const toggleChip = (h) => setSosChips((c) => (c.includes(h) ? c.filter((x) => x !== h) : [...c, h]));
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

  const householdMembers = people.filter((p) => p.member_id);
  const sosTotal = 1 + sosWith.length + sosOthers;
  const handleTriggerSOS = () => { setSosWith(householdMembers.filter((m) => !m.missing).map((m) => m.member_id)); setSosOthers(0); setConfirmVisible(true); };

  const sendSos = async () => {
    setConfirmVisible(false);
    setBusy(true);
    try {
      const note = [...sosChips, sosNote.trim()].filter(Boolean).join(', ');
      const coords = await getCurrentCoords({ precise: true });
      setSos(await raiseSos(selectedEmergency.id, coords, note, { headcount: sosTotal, withMembers: sosWith }));
      setSosNote('');
      setSosChips([]);
      if (!coords) Alert.alert('SOS sent', 'Location was not available, so your registered home location was sent instead.');
    } catch (e) {
      Alert.alert('SOS not sent', `${e.message}\n\nIf you cannot get through, call the MDRRMO hotline.`);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmCancelSOS = async (reason) => {
    setCancelModalVisible(false);
    setBusy(true);
    try {
      setSos(await cancelSos(reason));
      Alert.alert('SOS cancelled ✅', 'The responders were told your household no longer needs rescue.');
    } catch (e) {
      Alert.alert('Could not cancel', e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleMissing = (person) => {
    if (person.kind !== 'member') return;
    const isMissing = person.missing;
    Alert.alert(isMissing ? 'Mark Safe?' : 'Report Missing?', `Tell the MDRRMO about ${person.name}?`, [
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

  // Room at each centre. Free spaces count seats reserved for households a rescuer is bringing in,
  // the same numbers the server uses; until those load, fall back to the map's own counts.
  const avail = useCenterAvailability();
  const roomOf = (c) => {
    const a = avail.byId[c.center_id];
    const capacity = a?.capacity ?? (Number(c.capacity) || 0);
    const taken = a ? a.occupied + a.reserved : Number(c.occupied) || 0;
    const free = a ? a.available : Math.max(0, capacity - taken);
    return { capacity, free, load: shelterLoad({ capacity, occupied: capacity - free }) };
  };
  const withDistance = (from) => centers
    .map((c) => ({ ...c, ...roomOf(c), distance: distanceMeters(from, { lat: Number(c.latitude), lng: Number(c.longitude) }) }))
    .sort((a, b) => (a.distance ?? 1e12) - (b.distance ?? 1e12));
  const hasRoom = (c) => c.free > 0;
  // Shelter suggestion: the barangay's designated shelter (shelter plan) while it has room, else the
  // nearest centre with room to home; when away from home, the nearest one to where the resident is now.
  const designatedId = plan?.centers?.find((c) => c.is_primary)?.center_id;
  const designated = withDistance(homeCoords).filter(hasRoom).find((c) => c.center_id === designatedId);
  const homeShelter = designated || withDistance(homeCoords).filter(hasRoom)[0];
  // The designated shelter when it is open but has no room, so the resident knows why another one is suggested.
  const designatedFull = designatedId != null && !designated ? centers.find((c) => c.center_id === designatedId) : null;
  const nearestShelter = withDistance(currentGps || homeCoords).filter(hasRoom)[0];
  const suggested = isDisplaced ? nearestShelter : homeShelter;
  // All centres from where the resident is: ones with room first (nearest first), full ones last.
  const sortedCenters = withDistance(currentGps || homeCoords)
    .sort((a, b) => Number(!hasRoom(a)) - Number(!hasRoom(b)));
  // Already checked in at (or on the way to) a centre: that centre is the one to show, not another.
  const meAtCentre = people.find((p) => p.kind === 'resident' && ['safely_evacuated', 'in_transit'].includes(p.evac_status));
  const myCentre = meAtCentre ? sortedCenters.find((c) => c.center_name === meAtCentre.center_name) : null;
  const goTo = myCentre || suggested;
  const showTheWay = (c) => router.push({ pathname: '/(resident)/evac-map', params: { goCenterId: String(c.center_id), goCenterTs: String(Date.now()) } });
  const roomText = (c, here = false) => (c.free <= 0
    ? (here ? 'Full' : 'Full. Choose another shelter.')
    : `${c.free} ${c.free === 1 ? 'space' : 'spaces'} left${c.load.label === 'NEAR CAPACITY' ? ', filling up' : ''}`);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top Header */}
      <View style={styles.topHeader}>
        <View>
          <Text style={styles.headerSub}>MY HOUSEHOLD</Text>
          <Text style={styles.headerTitle}>{fullName || 'Resident'}</Text>
        </View>
        <TouchableOpacity
          style={[styles.badgeVerified, !profile?.is_verified && styles.badgePending]}
          disabled={Boolean(profile?.is_verified)}
          accessibilityRole="button"
          onPress={() => Alert.alert(
      'Get verified at your barangay hall 🪪',
      'Bring a valid ID to your barangay hall. Until your account is verified:\n\n• You can still send an SOS at any time.\n• You can have 1 hazard report waiting to be checked (3 when verified).\n• Your "I see it too" does not raise a hazard\'s alarm level.',
          )}
        >
          <Text style={[styles.badgeVerifiedText, !profile?.is_verified && { color: '#B45309' }]}>
            {profile?.is_verified ? '✓ VERIFIED' : 'NOT VERIFIED YET ⓘ'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Active disaster declarations for the resident's barangay (live from the web console) */}
      <DisasterBanner compact events={events} style={{ marginHorizontal: 14, marginTop: 8 }} />

      {/* Who in the household is at an evacuation centre, with Check out */}
      <AtCentreCard people={people} profileUid={profile?.uid} activeDisasters={events} onDone={load}
        style={{ marginHorizontal: 14, marginTop: 8 }} />

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
                <Text style={styles.label}>1. WHAT IS THE EMERGENCY?</Text>
                <View style={styles.grid}>
                  {EMERGENCY_TYPES.map((t) => (
                    <TouchableOpacity
                      key={t.id}
                      style={[styles.pill, selectedEmergency.id === t.id && styles.pillActive]}
                      onPress={() => { setSelectedEmergency(t); setSosChips([]); }}
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
                      <Text style={styles.sosLabel}>SEND SOS</Text>
                      <Text style={styles.sosSub}>{selectedEmergency.label}</Text>
                    </>
                  )}
                </TouchableOpacity>
                <Text style={styles.sub}>Sends your location and household details to the MDRRMO</Text>
              </View>
            </>
          ) : (
            /* Active Distress State with Cancel / Self-Evacuation Flow */
            <View style={[styles.activeSosCard, { marginTop: 10 }]}>
              <Text style={styles.activeSosTitle}>⚠️ {sosType.icon} {sosType.label.toUpperCase()} ACTIVE</Text>
              <Text style={styles.activeSosSub}>
                Sent at {clock(sos.created_at)} • {sos.headcount} person(s) • Priority level {sos.alert_level}
              </Text>
              {sos.note ? <Text style={styles.activeSosSub}>📝 Your note: {sos.note}</Text> : null}

              <View style={styles.trackerBox}>
                <Text style={styles.stepDone}>✓ 1. SOS sent to the MDRRMO</Text>
                <Text style={sos.ticket ? styles.stepDone : styles.stepActive}>
                  {sos.ticket ? `✓ 2. ${sos.ticket.unit_name || 'Rescue team'} assigned (${sos.ticket.status.replace('_', ' ')})` : '● 2. Waiting for a rescue team to be assigned'}
                </Text>
                <Text style={sos.app_status === 'EVACUATED' ? styles.stepDone : styles.stepPending}>
                  {sos.app_status === 'EVACUATED' ? `✓ 3. Admitted to ${sos.shelter}` : '○ 3. Admitted to an evacuation centre'}
                </Text>
              </View>

              {/* Live rescue unit: distance, GPS accuracy and how fresh the position is */}
              <RescueStatusCard mission={rescue.mission} online={rescue.online} style={{ marginBottom: 8 }} />

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <TouchableOpacity style={styles.btnPrimary} onPress={() => router.push('/(resident)/evac-map')}>
                  <Text style={styles.btnPrimaryText}>🗺️ View Map</Text>
                </TouchableOpacity>
                {/* Cancel SOS button */}
                <TouchableOpacity style={styles.btnCancelDistress} onPress={() => setCancelModalVisible(true)} disabled={busy}>
                  <Text style={styles.btnCancelDistressText}>✕ Cancel SOS / We left on our own</Text>
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
          {/* 1. Where to go: one clear shelter with a button that shows the way. */}
          <View style={[styles.goCard, isDisplaced && !myCentre && styles.goCardAway]}>
            <Text style={[styles.label, { color: isDisplaced && !myCentre ? '#B45309' : '#1E3A8A' }]}>
              {myCentre ? (meAtCentre.evac_status === 'in_transit' ? 'YOU ARE ON THE WAY TO' : 'YOU ARE CHECKED IN AT')
                : !goTo ? 'EVACUATION CENTRES'
                : isDisplaced ? `YOU ARE AWAY FROM HOME${distFromHome != null ? ` (${formatDistance(distFromHome)})` : ''}`
                : designated ? "YOUR BARANGAY'S SHELTER" : 'NEAREST SHELTER WITH ROOM'}
            </Text>
            {goTo ? (
              <>
                <Text style={styles.goName}>{goTo.center_name}</Text>
                <Text style={styles.goMeta}>
                  {[goTo.distance != null ? `${formatDistance(goTo.distance)} away` : null, roomText(goTo, Boolean(myCentre))].filter(Boolean).join(' • ')}
                </Text>
                {!myCentre && isDisplaced && <Text style={styles.goNote}>This is the nearest shelter to where you are now.</Text>}
                {!myCentre && !isDisplaced && designatedFull && (
                  <Text style={styles.goNote}>Your barangay's shelter, {designatedFull.center_name}, is full, so this is the nearest one with room.</Text>
                )}
                <TouchableOpacity style={styles.goBtn} onPress={() => showTheWay(goTo)} accessibilityRole="button">
                  <Text style={styles.goBtnText}>{myCentre ? '🗺️ Show it on the map' : '🧭 Show me the way'}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={[styles.goMeta, { marginTop: 4 }]}>
                {centers.length ? 'Every shelter is full right now. Stay where you are safe, or send an SOS if you need help.'
                  : 'No evacuation centre is open right now. If you need help, send an SOS.'}
              </Text>
            )}
          </View>

          {/* 2. Every open shelter: tap one to see the way there. */}
          {sortedCenters.length > 0 && (
            <Text style={[styles.sectionHeader, { marginTop: 4 }]}>ALL SHELTERS ({sortedCenters.length})</Text>
          )}
          {sortedCenters.map((s) => {
            const full = !hasRoom(s);
            const isSuggested = goTo?.center_id === s.center_id;
            return (
              <TouchableOpacity key={s.center_id} style={[styles.card, full && styles.cardFull, isSuggested && styles.cardSuggested]}
                onPress={() => showTheWay(s)} accessibilityRole="button"
                accessibilityLabel={`${s.center_name}. ${roomText(s)} Show the way.`}>
                {isSuggested && <Text style={styles.suggestTag}>{myCentre ? '✓ YOU ARE HERE' : '★ SUGGESTED FOR YOU'}</Text>}
                <View style={styles.shelterHeaderRow}>
                  <Text style={[styles.shelterTitle, full && { color: '#64748B' }]}>{s.center_name}</Text>
                  <Text style={[styles.shelterPercent, { color: s.load.color }]}>{full ? 'FULL' : s.load.label}</Text>
                </View>
                <Text style={[styles.roomText, full && { color: '#B91C1C' }]}>{roomText(s, isSuggested && Boolean(myCentre))}</Text>
                <View style={styles.barBg}>
                  <View style={{ height: '100%', width: `${s.load.percent}%`, backgroundColor: s.load.color }} />
                </View>
                <View style={styles.shelterFoot}>
                  <Text style={styles.sub}>{s.distance != null ? `📍 ${formatDistance(s.distance)} away` : ' '}</Text>
                  <Text style={styles.wayLink}>Show the way ›</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          {/* 3. The household: where everyone is, with a separate button to report someone missing. */}
          <View style={[styles.card, { marginTop: 6 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <Text style={styles.sectionHeader}>YOUR HOUSEHOLD</Text>
              <TouchableOpacity onPress={() => router.push('/(resident)/profile')} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.editLink}>Edit</Text>
              </TouchableOpacity>
            </View>
            {people.map((m) => {
              const badge = personBadge(m);
              const missing = badge === 'MISSING';
              return (
                <View key={m.member_id || m.uid} style={styles.memberRow}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.val}>{m.name}</Text>
                    <Text style={styles.sub}>
                      {[m.kind === 'resident' ? 'You' : m.relationship, MOBILITY_LABELS[m.mobility],
                        // The centre only while they are there or on the way, not after they went home.
                        ['safely_evacuated', 'in_transit'].includes(m.evac_status) ? `at ${m.center_name}` : null]
                        .filter(Boolean).join(' • ')}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <View style={[styles.badge, missing ? styles.bgDanger : styles.bgNeutral]}>
                      <Text style={[styles.badgeText, missing && { color: '#B91C1C' }]}>{badge}</Text>
                    </View>
                    {m.kind === 'member' && (
                      <TouchableOpacity style={[styles.missingBtn, missing && styles.foundBtn]} onPress={() => handleToggleMissing(m)}
                        accessibilityRole="button" accessibilityLabel={missing ? `Mark ${m.name} as found` : `Report ${m.name} missing`}>
                        <Text style={[styles.missingBtnText, missing && { color: '#15803D' }]}>{missing ? 'Mark found' : 'Report missing'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* Cancel SOS dialog */}
      {/* Confirm SOS: optional details for the MDRRMO and responders, then send */}
      <Modal visible={confirmVisible} transparent animationType="slide" onRequestClose={() => setConfirmVisible(false)}>
        <View style={styles.sheetBg}>
          <ScrollView style={styles.sheet} contentContainerStyle={{ paddingBottom: 28 }}>
            <Text style={styles.sheetTitle}>{selectedEmergency.icon} Send {selectedEmergency.label} SOS?</Text>
            <Text style={styles.sheetSub}>Your location will be sent to the MDRRMO.</Text>
            <Text style={[styles.label, { marginTop: 12 }]}>WHO IS WITH YOU RIGHT NOW?</Text>
            {householdMembers.length > 0 && <Text style={styles.sheetSub}>Untick anyone in your household who is not with you.</Text>}
            {householdMembers.map((m) => {
              const on = sosWith.includes(m.member_id);
              return (
                <TouchableOpacity key={m.member_id} style={styles.withRow} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                  onPress={() => setSosWith((w) => (on ? w.filter((x) => x !== m.member_id) : [...w, m.member_id]))}>
                  <Text style={styles.withTick}>{on ? '☑' : '☐'}</Text>
                  <Text style={styles.withName}>{m.name}{m.relationship ? ` (${m.relationship})` : ''}</Text>
                </TouchableOpacity>
              );
            })}
            <Text style={[styles.sheetSub, { marginTop: 8 }]}>Others with you (not in your household)</Text>
            <View style={styles.counterRow}>
              <TouchableOpacity style={styles.counterBtn} onPress={() => setSosOthers((n) => Math.max(0, n - 1))}
                accessibilityRole="button" accessibilityLabel="One less person">
                <Text style={styles.counterBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.counterValue} accessibilityLiveRegion="polite">{sosOthers}</Text>
              <TouchableOpacity style={styles.counterBtn} onPress={() => setSosOthers((n) => Math.min(49 - sosWith.length, n + 1))}
                accessibilityRole="button" accessibilityLabel="One more person">
                <Text style={styles.counterBtnText}>+</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.withTotal}>{sosTotal} {sosTotal === 1 ? 'person' : 'people'} in total, including you</Text>
            <Text style={[styles.label, { marginTop: 12 }]}>ANYTHING THE RESPONDERS SHOULD KNOW? (OPTIONAL)</Text>
            <View style={styles.hintRow}>
              {(NOTE_HINTS[selectedEmergency.id] || []).map((h) => {
                const on = sosChips.includes(h);
                return (
                  <TouchableOpacity key={h} style={[styles.hintChip, on && styles.hintChipOn]} onPress={() => toggleChip(h)}
                    accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                    <Text style={[styles.hintText, on && styles.hintTextOn]}>{on ? '✓ ' : ''}{h}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput
              style={styles.noteInput}
              value={sosNote}
              onChangeText={setSosNote}
              placeholder="Other details (e.g. water is waist deep)"
              placeholderTextColor="#94A3B8"
              multiline
              maxLength={400}
            />
            <TouchableOpacity style={styles.sheetSend} onPress={sendSos} accessibilityRole="button">
              <Text style={styles.sheetSendText}>SEND SOS NOW</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetCancel} onPress={() => setConfirmVisible(false)}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={cancelModalVisible} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>CANCEL YOUR SOS?</Text>
            <Text style={styles.dialogSub}>
              Why are you cancelling?
            </Text>

            <View style={{ gap: 8, marginVertical: 12 }}>
              <TouchableOpacity style={styles.cancelReasonBtn} onPress={() => handleConfirmCancelSOS('self_evacuated')}>
                <Text style={styles.cancelReasonTitle}>🚶 We left on our own</Text>
                <Text style={styles.cancelReasonDesc}>We reached a safe place or an upper floor.</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelReasonBtn} onPress={() => handleConfirmCancelSOS('threat_receded')}>
                <Text style={styles.cancelReasonTitle}>🏡 Safe at home now</Text>
                <Text style={styles.cancelReasonDesc}>The danger passed; we no longer need help.</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelReasonBtn} onPress={() => handleConfirmCancelSOS('accidental')}>
                <Text style={[styles.cancelReasonTitle, { color: '#DC2626' }]}>⚠️ Sent by mistake</Text>
                <Text style={styles.cancelReasonDesc}>Cancel with no penalty.</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.btnKeepSos} onPress={() => setCancelModalVisible(false)}>
              <Text style={styles.btnKeepSosText}>Keep my SOS</Text>
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
  hintRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  hintChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  hintText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  hintChipOn: { backgroundColor: '#FEE2E2', borderColor: '#DC2626' },
  hintTextOn: { color: '#B91C1C' },
  sheetBg: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFF', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, flexGrow: 0, maxHeight: '90%' },
  withRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  withTick: { fontSize: 22, color: '#B91C1C' },
  withName: { fontSize: 15, fontWeight: '700', color: '#0F172A', flex: 1 },
  withTotal: { fontSize: 13, fontWeight: '800', color: '#B91C1C', marginTop: 6 },
  sheetTitle: { fontSize: 19, fontWeight: '900', color: '#0F172A' },
  sheetSub: { fontSize: 13, color: '#475569', marginTop: 4 },
  counterRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6 },
  counterBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center' },
  counterBtnText: { fontSize: 22, fontWeight: '900', color: '#0F172A' },
  counterValue: { fontSize: 17, fontWeight: '900', color: '#0F172A', minWidth: 90, textAlign: 'center' },
  sheetSend: { backgroundColor: '#DC2626', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 14 },
  sheetSendText: { color: '#FFF', fontWeight: '900', fontSize: 17, letterSpacing: 0.5 },
  sheetCancel: { alignItems: 'center', paddingVertical: 12 },
  sheetCancelText: { color: '#475569', fontWeight: '800', fontSize: 14 },
  noteInput: { marginTop: 8, minHeight: 60, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 10, fontSize: 14, color: '#0F172A', textAlignVertical: 'top', backgroundColor: '#FFF' },
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
  goCard: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 14 },
  goCardAway: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  goName: { fontSize: 20, fontWeight: FONT_WEIGHTS.black, color: '#0F172A' },
  goMeta: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#334155', marginTop: 2 },
  goNote: { fontSize: FONT_SIZES.tiny, color: '#475569', marginTop: 6 },
  goBtn: { backgroundColor: '#1E3A8A', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  goBtnText: { color: '#FFF', fontSize: 16, fontWeight: FONT_WEIGHTS.black },
  cardFull: { backgroundColor: '#F8FAFC', opacity: 0.85 },
  cardSuggested: { borderColor: '#1E3A8A', borderWidth: 1.5 },
  suggestTag: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.black, color: '#1E3A8A', marginBottom: 4 },
  roomText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#334155' },
  shelterFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  wayLink: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#1E3A8A' },
  editLink: { color: '#1E3A8A', fontWeight: FONT_WEIGHTS.extraBold, fontSize: FONT_SIZES.caption, marginBottom: 8 },
  missingBtn: { borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FFF', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  foundBtn: { borderColor: '#86EFAC' },
  missingBtnText: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#B91C1C' },
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