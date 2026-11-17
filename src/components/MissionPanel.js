// Rescuer's mission card inside the resident sheet. The mission goes:
//   on the way -> CONFIRM ARRIVAL AT RESIDENT (GPS suggests it, the rescuer confirms)
//   -> ROUTE TO NEAREST AVAILABLE EVACUATION CENTER (road distance, never a full center)
//   -> START NAVIGATION (resident is told) -> CONFIRM SUCCESSFUL EVACUATION.
// Seats are reserved by the server in one locked transaction, so two units can
// never take the same last seats.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getMissionStatus, getCenterAvailability, confirmResidentLocated, assignEvacuationCenter,
  releaseEvacuationReservation, confirmEvacuationArrival, startEvacuation, onLiveSignal,
} from '../services/api';
import { flushNow, GPS_STALE_MS } from '../lib/rescueTracker';
import { distanceMeters, formatDistance } from '../lib/location';
import { rankCentersByRoad } from '../lib/roadRouting';
import { timeAgo } from '../lib/rescuerFeed';

const CENTERS_KEY = 'pc.rescue.centers.v1';

const ago = (d) => {
  if (!d) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : timeAgo(d);
};
const minutes = (sec) => (sec == null ? '' : `${Math.max(1, Math.round(sec / 60))} min`);
const isNetworkError = (e) => /network|fetch|timeout|offline|failed to fetch/i.test(String(e?.message || e));
const typeLabel = (t) => (t ? String(t).replace(/_/g, ' ') : '');

export function GpsStatusLine({ tracker }) {
  const fix = tracker.fix;
  const live = fix && Date.now() - new Date(fix.at).getTime() < GPS_STALE_MS;
  let text;
  let color = '#15803D';
  if (tracker.permission === 'denied') { text = 'Location permission is off. Allow it so the resident can see you coming.'; color = '#B91C1C'; }
  else if (!tracker.servicesOn) { text = 'Phone location is switched off. Turn it on to share your position.'; color = '#B91C1C'; }
  else if (!fix) { text = 'Waiting for a GPS fix…'; color = '#B45309'; }
  else {
    text = `${live ? 'GPS live' : 'GPS signal lost'} • ±${fix.accuracy ?? '?'} m • fix ${ago(fix.at)}`;
    if (!live) color = '#B45309';
  }
  let sync = '';
  if (tracker.ticketId) {
    sync = tracker.online
      ? ` • sent ${ago(tracker.lastSentAt)}`
      : ` • OFFLINE, ${tracker.queued} fix${tracker.queued === 1 ? '' : 'es'} waiting to send`;
  }
  return <Text style={[styles.gpsLine, { color }]}>📡 {text}{sync}</Text>;
}

export default function MissionPanel({ res, tracker, onTarget, onClosed }) {
  const ticketId = res.ticketId;
  const [mission, setMission] = useState(null);
  const [offline, setOffline] = useState(false);
  const [cache, setCache] = useState(null);      // { at, centers } last synced availability
  const [busy, setBusy] = useState(false);
  const [noCenter, setNoCenter] = useState(null); // reply when no center could take the household
  const [pick, setPick] = useState(null);         // { centerId, byRoad, road_m, road_s }
  const [navigating, setNavigating] = useState(false);
  const fixRef = useRef(tracker.fix);
  fixRef.current = tracker.fix;

  const saveCache = (a) => {
    const saved = { at: a.as_of || new Date().toISOString(), centers: a.centers || [] };
    setCache(saved);
    AsyncStorage.setItem(CENTERS_KEY, JSON.stringify(saved)).catch(() => {});
    return saved;
  };

  const load = useCallback(async () => {
    try {
      setMission(await getMissionStatus(ticketId));
      setOffline(false);
    } catch (e) {
      if (isNetworkError(e)) setOffline(true);
    }
  }, [ticketId]);

  useEffect(() => {
    AsyncStorage.getItem(CENTERS_KEY).then((raw) => raw && setCache((c) => c || JSON.parse(raw))).catch(() => {});
    load();
    const off = onLiveSignal(['tickets', 'centers', 'evacuation'], load);
    const timer = setInterval(load, 20000);
    return () => { off(); clearInterval(timer); };
  }, [load]);

  const a = mission?.assignment;
  const reserved = a && a.status === 'reserved' ? a : null;

  // Map: route preview to the reserved center, turn-by-turn while navigating.
  useEffect(() => {
    onTarget?.(reserved ? {
      key: `${reserved.center_id}`, lat: Number(reserved.latitude), lng: Number(reserved.longitude),
      name: reserved.center_name, navigate: navigating,
    } : null);
  }, [reserved?.center_id, reserved?.latitude, reserved?.longitude, navigating]);
  useEffect(() => () => onTarget?.(null), []);
  useEffect(() => { if (!reserved) setNavigating(false); }, [reserved?.center_id]);

  const act = async (fn, failTitle) => {
    setBusy(true);
    try {
      const out = await fn();
      await load();
      return out ?? true;
    } catch (e) {
      Alert.alert(failTitle, isNetworkError(e)
        ? 'No connection. This needs the server so the seats are really held. Try again when you have signal.'
        : e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const freshFix = () => {
    const f = fixRef.current;
    return f && Date.now() - new Date(f.at).getTime() < 120000 ? f : null;
  };

  // ---- 1. arrival at the resident (manual; GPS proximity only suggests it) ----
  const handleArrived = () => {
    Alert.alert(
      'Arrived at the resident?',
      `Confirm you are with ${res.name}. They will be told that you have arrived.`,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Confirm arrival',
          onPress: async () => {
            flushNow();
            const r = await act(() => confirmResidentLocated(ticketId, freshFix()), 'Arrival not saved');
            if (r) Alert.alert('Arrival confirmed ✅', 'The resident was notified. Next: route to the nearest available evacuation center.');
          },
        },
      ],
    );
  };

  // ---- 2. nearest center with room, by ROAD distance ----
  const handleRoute = async (exclude = []) => {
    setBusy(true);
    try {
      const from = mission?.located
        ? { lat: Number(mission.located.latitude), lng: Number(mission.located.longitude) }
        : freshFix() || { lat: res.lat, lng: res.lng };
      const head = mission?.headcount || res.householdSize || 1;
      const avail = saveCache(await getCenterAvailability());
      // Only active centers with room for the whole household; the server checks again under lock.
      const fits = avail.centers.filter((c) => c.status === 'active' && c.available >= head && !exclude.includes(c.center_id));
      const ranked = await rankCentersByRoad(from, fits);
      const r = await assignEvacuationCenter(ticketId, {
        fix: from, exclude, roadOrder: ranked.centers.map((c) => c.center_id),
      });
      await load();
      if (!r?.assigned) {
        setNoCenter(r);
        setPick(null);
        Alert.alert('No available evacuation center found',
          `${r?.reason || 'No center has room.'}\n\nThe EOC has been sent a shelter request for this household. Radio the MDRRMO to coordinate a place.`);
        return;
      }
      setNoCenter(null);
      const hit = ranked.centers.find((c) => c.center_id === r.center.center_id);
      const byRoad = ranked.byRoad && hit?.road_m != null;
      setPick({ centerId: r.center.center_id, byRoad, road_m: hit?.road_m, road_s: hit?.road_s });
      const dist = byRoad
        ? `${formatDistance(Math.round(hit.road_m))} by road, about ${minutes(hit.road_s)}`
        : `${formatDistance(r.center.distance_m)} in a straight line (road router unreachable)`;
      Alert.alert('🏫 Evacuation center selected', `${r.center.center_name}\n${dist}\n${r.center.available} slots still free after reserving ${r.headcount} for this household.`);
    } catch (e) {
      Alert.alert('Center not selected', isNetworkError(e)
        ? 'No connection. A center can only be reserved online so its capacity is really checked. Try again when you have signal.'
        : e.message);
    } finally {
      setBusy(false);
    }
  };

  // ---- 3. start / end navigation ----
  const handleStartNav = async () => {
    if (!mission?.evacuation_started_at) {
      const r = await act(() => startEvacuation(ticketId), 'Navigation not started');
      if (!r) return;
    }
    setNavigating(true);
  };

  const handleChange = () => {
    Alert.alert('Change evacuation center?', `Release the seats at ${reserved.center_name} and reserve the next nearest center with room?`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Change center', onPress: () => handleRoute([reserved.center_id]) },
    ]);
  };

  const handleCancel = () => {
    Alert.alert('Cancel the reservation?', `The ${reserved.headcount} slots at ${reserved.center_name} go back to other rescues.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel reservation', style: 'destructive',
        onPress: async () => {
          setNavigating(false);
          await act(() => releaseEvacuationReservation(ticketId, 'Cancelled by the rescue unit'), 'Not cancelled');
        },
      },
    ]);
  };

  // ---- 4. arrival at the center: seats become occupancy, mission closes ----
  const handleAtCenter = () => {
    Alert.alert('Arrived at the evacuation center?', `Check in ${res.name}${reserved.headcount > 1 ? ` and household (${reserved.headcount} people)` : ''} at ${reserved.center_name}. This closes the mission.`, [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Confirm successful evacuation',
        onPress: async () => {
          const r = await act(() => confirmEvacuationArrival(ticketId, 'Arrived with the rescue unit'), 'Arrival not saved');
          if (r) {
            setNavigating(false);
            Alert.alert('Evacuation complete ✅', `${r.headcount ?? reserved.headcount} checked in at ${reserved.center_name}. The resident was notified.`);
            onClosed?.();
          }
        },
      },
    ]);
  };

  const located = Boolean(mission?.located_at);
  const stage = tracker.server?.ticketId === ticketId ? tracker.server.proximity_stage : mission?.proximity_stage;
  const distToResident = distanceMeters(tracker.fix, { lat: res.lat, lng: res.lng });
  const pickHere = pick && reserved && pick.centerId === reserved.center_id ? pick : null;
  const straightToCenter = reserved ? distanceMeters(tracker.fix, { lat: Number(reserved.latitude), lng: Number(reserved.longitude) }) : null;

  return (
    <View style={styles.wrap}>
      <GpsStatusLine tracker={tracker} />
      {offline && (
        <Text style={styles.offline}>
          ⚠️ Offline. Showing what was last synced{cache ? ` (${ago(cache.at)})` : ''}. Center slots are not confirmed until you are back online.
        </Text>
      )}

      {!located && (
        <>
          {stage === 'critical' ? (
            <Text style={[styles.stage, styles.stageCritical]}>📍 GPS shows you have reached the resident. Confirm arrival when you are with them.</Text>
          ) : stage === 'nearby' ? (
            <Text style={[styles.stage, styles.stageNear]}>📍 About 10 m from the resident.</Text>
          ) : stage === 'approaching' ? (
            <Text style={[styles.stage, styles.stageApproach]}>🚑 Within 100 m of the resident.</Text>
          ) : distToResident != null ? (
            <Text style={styles.muted}>{formatDistance(distToResident)} from the SOS point (your GPS).</Text>
          ) : null}
          <TouchableOpacity style={styles.btnPrimary} onPress={handleArrived} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnText}>✅ CONFIRM ARRIVAL AT RESIDENT</Text>}
          </TouchableOpacity>
        </>
      )}

      {located && !reserved && (
        <>
          {noCenter && (
            <View style={[styles.card, styles.cardWarn]}>
              <Text style={[styles.cardKicker, { color: '#B91C1C' }]}>⚠️ NO AVAILABLE EVACUATION CENTER FOUND</Text>
              <Text style={styles.cardLine}>
                {noCenter.reason} No route was made to a full center.
                {mission?.open_shelter_request ? ' The EOC has a shelter request for this household.' : ''} Radio the MDRRMO to coordinate a place, then try again.
              </Text>
            </View>
          )}
          <TouchableOpacity style={styles.btnRoute} onPress={() => handleRoute()} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnText}>🧭 ROUTE TO NEAREST AVAILABLE EVACUATION CENTER</Text>}
          </TouchableOpacity>
        </>
      )}

      {located && reserved && (
        <View style={styles.card}>
          <Text style={styles.cardKicker}>🏫 EVACUATION CENTER{reserved.override ? ' (EOC-APPROVED ALTERNATIVE)' : ''}</Text>
          <Text style={styles.cardTitle}>{reserved.center_name}</Text>
          <Text style={styles.cardLine}>
            {[reserved.barangay_name && `Brgy. ${reserved.barangay_name}`, typeLabel(reserved.center_type)].filter(Boolean).join(' • ')}
          </Text>
          <Text style={styles.cardLine}>
            {pickHere?.byRoad
              ? `${formatDistance(Math.round(pickHere.road_m))} by road, about ${minutes(pickHere.road_s)}`
              : straightToCenter != null ? `${formatDistance(straightToCenter)} in a straight line` : ''}
          </Text>
          <Text style={styles.cardLine}>
            {reserved.headcount} slot{reserved.headcount === 1 ? '' : 's'} reserved • {reserved.available} still free of {reserved.capacity}
          </Text>
          <Text style={[styles.cardLine, { color: reserved.center_status === 'active' ? '#15803D' : '#B91C1C', fontWeight: '800' }]}>
            {reserved.center_status === 'active' ? 'ACCEPTING EVACUEES' : 'CENTER CLOSED: change center'}
            {offline ? ' • last synced, not confirmed' : ''}
          </Text>

          {navigating ? (
            <TouchableOpacity style={[styles.btnPrimary, { backgroundColor: '#475569', marginTop: 6 }]} onPress={() => setNavigating(false)}>
              <Text style={styles.btnText}>■ END NAVIGATION</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.btnRoute, { marginTop: 6 }]} onPress={handleStartNav} disabled={busy}>
              {busy ? <ActivityIndicator color="#FFF" /> : (
                <Text style={styles.btnText}>{mission?.evacuation_started_at ? '▶ RESUME NAVIGATION' : '▶ START NAVIGATION'}</Text>
              )}
            </TouchableOpacity>
          )}
          <View style={styles.row}>
            <TouchableOpacity style={[styles.btnSmall, styles.btnGhost]} onPress={handleChange} disabled={busy}>
              <Text style={styles.btnGhostText}>Change center</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btnSmall, styles.btnGhost]} onPress={handleCancel} disabled={busy}>
              <Text style={[styles.btnGhostText, { color: '#B91C1C' }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.btnDone} onPress={handleAtCenter} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnText}>✅ CONFIRM SUCCESSFUL EVACUATION</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 6, gap: 6 },
  gpsLine: { fontSize: 10.5, fontWeight: '700' },
  offline: { fontSize: 10.5, fontWeight: '700', color: '#B45309', backgroundColor: '#FEF3C7', padding: 6, borderRadius: 6 },
  muted: { fontSize: 10.5, color: '#475569' },
  stage: { fontSize: 11.5, fontWeight: '900', padding: 7, borderRadius: 6, overflow: 'hidden' },
  stageApproach: { color: '#1E3A8A', backgroundColor: '#DBEAFE' },
  stageNear: { color: '#B45309', backgroundColor: '#FEF3C7' },
  stageCritical: { color: '#FFFFFF', backgroundColor: '#DC2626' },
  btnPrimary: { backgroundColor: '#7C3AED', borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  btnRoute: { backgroundColor: '#1D4ED8', borderRadius: 8, paddingVertical: 11, paddingHorizontal: 8, alignItems: 'center' },
  btnDone: { backgroundColor: '#16A34A', borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginTop: 6 },
  btnText: { color: '#FFFFFF', fontWeight: '900', fontSize: 12, textAlign: 'center' },
  card: { borderWidth: 1, borderColor: '#BBF7D0', backgroundColor: '#F0FDF4', borderRadius: 8, padding: 9, gap: 2 },
  cardWarn: { borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  cardKicker: { fontSize: 9.5, fontWeight: '900', color: '#15803D', letterSpacing: 0.4 },
  cardTitle: { fontSize: 14, fontWeight: '900', color: '#0F172A' },
  cardLine: { fontSize: 11, color: '#334155' },
  row: { flexDirection: 'row', gap: 6, marginTop: 6 },
  btnSmall: { flex: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  btnGhost: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CBD5E1' },
  btnGhostText: { fontWeight: '800', fontSize: 11.5, color: '#1E293B' },
});
