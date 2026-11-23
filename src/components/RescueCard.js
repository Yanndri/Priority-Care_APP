// The responder's one rescue card. One big button for the next step, small links for the rest:
//   1. Accept & go          (ticket -> en_route; the resident is told "on the way")
//   2. I'm with them        (resident located -> on_scene; the resident is told "arrived")
//   3. How did it end?
//        Take to a center   -> seats are reserved at the nearest center with room (searched from
//                              the RESIDENT's location), the route starts, the resident is told
//        Resolved here      -> pick a reason; the ticket closes with that reason
//   4. Arrived at center    (tick who arrived; they are checked in and the ticket closes)
// Seats are reserved by the server in one locked step, so two units never take the same last seats.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Modal, TextInput, ScrollView } from 'react-native';
import {
  getMissionStatus, getCenterAvailability, confirmResidentLocated, undoLastRescueStep, assignEvacuationCenter,
  releaseEvacuationReservation, confirmEvacuationArrival, startEvacuation, onLiveSignal,
  updateTicketStatus, recordEvacuation,
} from '../services/api';
import { distanceMeters, formatDistance } from '../lib/location';
import { rankCentersByRoad } from '../lib/roadRouting';

const RESOLVED_REASONS = ['Safe, staying home', 'Went to relatives', 'Brought to hospital'];
const isNetworkError = (e) => /network|fetch|timeout|offline|failed to fetch/i.test(String(e?.message || e));
const minutes = (sec) => (sec == null ? '' : `${Math.max(1, Math.round(sec / 60))} min`);

export default function RescueCard({ res, unitPos, compact, onCompact, onTarget, onClosed, onBackup }) {
  const ticketId = res.ticketId;
  const [mission, setMission] = useState(null);
  const [busy, setBusy] = useState(false);
  const [noCenter, setNoCenter] = useState(null);
  const [road, setRoad] = useState(null);           // { centerId, road_m, road_s } for the reserved center
  const [endModal, setEndModal] = useState(false);  // "Resolved here" reasons
  const [other, setOther] = useState('');
  const [arriveModal, setArriveModal] = useState(false);
  const [arrivedIds, setArrivedIds] = useState([]);

  const load = useCallback(async () => {
    try { setMission(await getMissionStatus(ticketId)); } catch { /* keep the last state */ }
  }, [ticketId]);

  useEffect(() => {
    load();
    const off = onLiveSignal(['tickets', 'centers', 'evacuation'], load);
    const timer = setInterval(load, 20000);
    return () => { off(); clearInterval(timer); };
  }, [load]);

  const a = mission?.assignment;
  const reserved = a && a.status === 'reserved' ? a : null;
  const located = Boolean(mission?.located_at);
  // The resident's location: where the SOS was sent from.
  const residentSpot = { lat: Number(res.lat), lng: Number(res.lng) };

  // Directions only when the responder asks: to the resident before a center is chosen, then to the
  // reserved center (turn by turn once the trip started). Hidden by default so the map stays calm.
  const [directions, setDirections] = useState(false);
  useEffect(() => {
    if (!directions) return onTarget?.(null);
    onTarget?.(reserved ? {
      key: `c${reserved.center_id}`, lat: Number(reserved.latitude), lng: Number(reserved.longitude),
      name: reserved.center_name, navigate: Boolean(mission?.evacuation_started_at),
    } : {
      key: `r${ticketId}`, kind: 'resident', lat: residentSpot.lat, lng: residentSpot.lng, name: res.name, navigate: false,
    });
    return undefined;
  }, [directions, reserved?.center_id, reserved?.latitude, reserved?.longitude, mission?.evacuation_started_at, residentSpot.lat, residentSpot.lng]);
  useEffect(() => () => onTarget?.(null), []);

  let step = 1;
  if (['EN_ROUTE', 'ON_SCENE'].includes(res.status)) step = 2;
  if (located) step = 3;
  if (located && reserved) step = 4;

  const act = async (fn, failTitle) => {
    setBusy(true);
    try {
      const out = await fn();
      await load();
      return out ?? true;
    } catch (e) {
      Alert.alert(failTitle, isNetworkError(e) ? 'No connection. Try again when you have signal.' : e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const closeTicket = async (note, doneTitle, doneText) => {
    const ok = await act(() => updateTicketStatus(ticketId, 'resolved', note), 'Not closed');
    if (ok) {
      Alert.alert(doneTitle, doneText);
      onClosed?.();
    }
  };

  // ---- 1 ----
  const acceptAndGo = () => act(() => updateTicketStatus(ticketId, 'en_route'), 'Not saved');

  // ---- 2 ----
  const withThem = () => act(() => confirmResidentLocated(ticketId, unitPos || null), 'Not saved');

  const notReal = () => {
    Alert.alert('Not a real emergency?', `Close ${res.name}'s SOS as a false alarm? The resident is told it is closed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Yes, close it', style: 'destructive',
        onPress: () => closeTicket('False alarm: not a real emergency', 'Closed', 'Saved as a false alarm.'),
      },
    ]);
  };

  // ---- 3a: take to a center (searched from the resident's location, not this phone's GPS) ----
  const takeToCentre = async (exclude = []) => {
    setBusy(true);
    try {
      const head = mission?.headcount || res.householdSize || 1;
      const avail = await getCenterAvailability();
      const fits = (avail?.centers || []).filter((c) => c.status === 'active' && c.available >= head && !exclude.includes(c.center_id));
      const ranked = await rankCentersByRoad(residentSpot, fits);
      const r = await assignEvacuationCenter(ticketId, {
        fix: residentSpot, exclude, roadOrder: ranked.centers.map((c) => c.center_id),
      });
      if (!r?.assigned) {
        if (exclude.length) Alert.alert('No other center has room', 'You keep the seats you already have.');
        setNoCenter(r?.reason || 'No center has room for this household.');
        await load();
        return;
      }
      setNoCenter(null);
      const hit = ranked.centers.find((c) => c.center_id === r.center.center_id);
      setRoad(ranked.byRoad && hit?.road_m != null ? { centerId: r.center.center_id, road_m: hit.road_m, road_s: hit.road_s } : null);
      await startEvacuation(ticketId); // the resident is told where they are going
      await load();
    } catch (e) {
      Alert.alert('No center chosen', isNetworkError(e)
        ? 'No connection. A center can only be reserved online so its seats are really checked.'
        : e.message);
    } finally {
      setBusy(false);
    }
  };

  // ---- 3b: resolved here ----
  const resolveHere = (reason) => {
    const text = String(reason || '').trim();
    if (!text) return Alert.alert('Add a reason', 'Type what happened.');
    setEndModal(false);
    setOther('');
    closeTicket(`Resolved on site: ${text}`, 'Rescue closed ✅', `Saved: ${text}. The resident was told their request is closed.`);
  };

  // ---- 4: arrived at the center ----
  const members = res.members || [];
  const openArrive = () => {
    if (!members.length) return confirmArrival(true);
    setArrivedIds(members.map((m) => m.id));
    setArriveModal(true);
  };

  const confirmArrival = async (everyone) => {
    setArriveModal(false);
    const centreName = reserved.center_name;
    let ok;
    if (everyone) {
      // Everyone came: the reserved seats become check-ins.
      ok = await act(() => confirmEvacuationArrival(ticketId, 'Arrived with the responder'), 'Not checked in');
    } else {
      // Only some came: free the seats, check in the ones who came, close with a count.
      const came = members.filter((m) => arrivedIds.includes(m.id));
      ok = await act(async () => {
        await releaseEvacuationReservation(ticketId, 'Only part of the household arrived');
        for (const m of members) {
          const person = m.kind === 'resident' ? { kind: 'resident', uid: m.uid } : { kind: 'member', member_id: m.member_id };
          await recordEvacuation(person, reserved.center_id, arrivedIds.includes(m.id) ? 'safely_evacuated' : 'failed');
        }
        await updateTicketStatus(ticketId, 'resolved', `Evacuated to ${centreName}: ${came.length}/${members.length} arrived`);
      }, 'Not checked in');
    }
    if (ok) {
      Alert.alert('Checked in ✅', `Checked in at ${centreName}. The resident was told.`);
      onClosed?.();
    }
  };

  const changeCentre = () => {
    Alert.alert('Change center?', `Free the seats at ${reserved.center_name} and pick the next nearest center with room?`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Change',
        // The server moves the seats in one step, so they are kept if no other center has room.
        onPress: () => takeToCentre([reserved.center_id]),
      },
    ]);
  };

  // ---- undo the last step ----
  const undo = () => {
    if (step === 4) {
      return Alert.alert('Undo "Take to a center"?', `The seats at ${reserved.center_name} are freed and you go back to "How did it end?".`, [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Undo', style: 'destructive',
          onPress: async () => {
            const ok = await act(() => releaseEvacuationReservation(ticketId, 'Responder undid the center choice'), 'Not undone');
            if (ok) { onCompact?.(false); onTarget?.(null); }
          },
        },
      ]);
    }
    // Steps 2-3: go one step back. Allowed any time while the rescue is open (a pocket tap may go
    // unnoticed); the ticket history records the undo, so nobody has to fix the record by hand.
    const what = step === 3 ? '"I\'m with them"' : '"Accept & go"';
    const back = step === 3 ? 'On the way' : 'Accept & go';
    return Alert.alert(`Undo ${what}?`, `Use this if it was tapped by mistake. The rescue goes back to "${back}" and the undo is saved in the history.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Undo', style: 'destructive', onPress: () => act(() => undoLastRescueStep(ticketId), 'Not undone') },
    ]);
  };

  // ---- compact: one line while the route shows ----
  const summary = {
    1: 'Accept & go',
    2: 'Going to the resident',
    3: 'How did it end?',
    4: reserved ? `🏥 ${reserved.center_name}${road?.centerId === reserved.center_id ? ` • ${formatDistance(Math.round(road.road_m))}` : ''}` : '',
  }[step];
  if (compact) {
    return (
      <TouchableOpacity style={styles.compact} onPress={() => onCompact?.(false)} activeOpacity={0.85}>
        <Text style={styles.compactText} numberOfLines={1}>Step {step} of 4 • {summary}</Text>
        <Text style={styles.compactOpen}>▴ Open</Text>
      </TouchableOpacity>
    );
  }

  const straight = reserved && unitPos
    ? distanceMeters(unitPos, { lat: Number(reserved.latitude), lng: Number(reserved.longitude) }) : null;

  const Big = ({ label, color, onPress }) => (
    <TouchableOpacity style={[styles.big, { backgroundColor: color }]} onPress={onPress} disabled={busy} activeOpacity={0.85}>
      {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.bigText}>{label}</Text>}
    </TouchableOpacity>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.stepRow}>
        <Text style={styles.stepText}>STEP {step} OF 4</Text>
        <TouchableOpacity style={styles.smallBtn} onPress={() => onCompact?.(true)}>
          <Text style={styles.smallBtnText}>🗺️ Show map</Text>
        </TouchableOpacity>
      </View>

      {step === 1 && <Big label="🚑 ACCEPT & GO" color="#1E3A8A" onPress={acceptAndGo} />}

      {step === 2 && <Big label="📍 I'M WITH THEM" color="#7C3AED" onPress={withThem} />}

      {step === 3 && (
        <>
          <Text style={styles.ask}>How did it end?</Text>
          {noCenter && (
            <Text style={styles.warn}>
              ⚠️ {noCenter} Radio the MDRRMO for a place, or choose "Resolved here".
            </Text>
          )}
          <View style={styles.twoRow}>
            <TouchableOpacity style={[styles.half, { backgroundColor: '#1D4ED8' }]} onPress={() => takeToCentre()} disabled={busy}>
              {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.bigText}>🏥 Take to a center</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.half, { backgroundColor: '#15803D' }]} onPress={() => setEndModal(true)} disabled={busy}>
              <Text style={styles.bigText}>✅ Resolved here</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {step === 4 && (
        <>
          <View style={styles.center}>
            <Text style={styles.centreName}>🏥 {reserved.center_name}{reserved.barangay_name ? `, Brgy. ${reserved.barangay_name}` : ''}</Text>
            <Text style={styles.centreLine}>
              {road?.centerId === reserved.center_id
                ? `${formatDistance(Math.round(road.road_m))} by road, about ${minutes(road.road_s)}`
                : straight != null ? `${formatDistance(straight)} away` : ''}
              {` • ${reserved.headcount} seat${reserved.headcount === 1 ? '' : 's'} kept`}
            </Text>
            {reserved.center_status !== 'active' && <Text style={styles.warn}>This center closed. Tap "Change center".</Text>}
          </View>
          <Big label="✅ ARRIVED AT CENTER" color="#16A34A" onPress={openArrive} />
        </>
      )}

      {/* Small actions as real buttons (easy to tap with wet hands or gloves). The household's details
          open from "Info" at the top of the card. */}
      <View style={styles.links}>
        {step <= 3 && step >= 2 && (
          <TouchableOpacity style={[styles.smallBtn, styles.smallBtnDanger]} onPress={notReal}>
            <Text style={[styles.smallBtnText, { color: '#B91C1C' }]}>Not a real emergency</Text>
          </TouchableOpacity>
        )}
        {step === 4 && (
          <TouchableOpacity style={styles.smallBtn} onPress={changeCentre}>
            <Text style={styles.smallBtnText}>Change center</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.smallBtn, directions && styles.smallBtnOn]} onPress={() => setDirections((d) => !d)}>
          <Text style={[styles.smallBtnText, directions && { color: '#FFFFFF' }]}>{directions ? 'Hide directions' : '🧭 Directions'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.smallBtn} onPress={onBackup}>
          <Text style={styles.smallBtnText}>+ Backup</Text>
        </TouchableOpacity>
        {step >= 2 && (
          <TouchableOpacity style={styles.smallBtn} onPress={undo}>
            <Text style={styles.smallBtnText}>{step === 4 ? '↩ Pick a different ending' : '↩ Undo last step'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Resolved here: why */}
      <Modal visible={endModal} transparent animationType="slide" onRequestClose={() => setEndModal(false)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Resolved here</Text>
            <Text style={styles.dialogSub}>What happened? This is saved on the rescue record.</Text>
            {RESOLVED_REASONS.map((r) => (
              <TouchableOpacity key={r} style={styles.option} onPress={() => resolveHere(r)}>
                <Text style={styles.optionText}>{r}</Text>
              </TouchableOpacity>
            ))}
            <TextInput
              style={styles.input} value={other} onChangeText={setOther}
              placeholder="Other (type what happened)" placeholderTextColor="#94A3B8" maxLength={300}
            />
            {other.trim() ? (
              <TouchableOpacity style={[styles.option, { backgroundColor: '#15803D' }]} onPress={() => resolveHere(other)}>
                <Text style={[styles.optionText, { color: '#FFF' }]}>Save "{other.trim()}"</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={() => { setEndModal(false); setOther(''); }} style={{ alignItems: 'center', paddingTop: 6 }}>
              <Text style={styles.link}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Arrived at center: who came */}
      <Modal visible={arriveModal} transparent animationType="slide" onRequestClose={() => setArriveModal(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.dialog, { maxHeight: '85%' }]}>
            <Text style={styles.dialogTitle}>Who arrived?</Text>
            <Text style={styles.dialogSub}>Untick anyone who did not come to {reserved?.center_name}.</Text>
            <ScrollView style={{ flexGrow: 0 }}>
              {members.map((m) => {
                const on = arrivedIds.includes(m.id);
                return (
                  <TouchableOpacity key={m.id} style={styles.tickRow}
                    onPress={() => setArrivedIds((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))}>
                    <Text style={styles.tick}>{on ? '☑' : '☐'}</Text>
                    <Text style={styles.optionText}>{m.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={[styles.option, { backgroundColor: '#16A34A', marginTop: 8 }]}
              onPress={() => {
                if (!arrivedIds.length) return Alert.alert('Nobody ticked', 'Tick at least one person, or use Undo if nobody came.');
                confirmArrival(arrivedIds.length === members.length);
              }}
            >
              <Text style={[styles.optionText, { color: '#FFF', textAlign: 'center' }]}>
                Check in {arrivedIds.length} of {members.length} and close
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setArriveModal(false)} style={{ alignItems: 'center', paddingTop: 8 }}>
              <Text style={styles.link}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  stepRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stepText: { fontSize: 10, fontWeight: '900', color: '#64748B', letterSpacing: 0.5 },
  ask: { fontSize: 13, fontWeight: '900', color: '#0F172A' },
  warn: { fontSize: 11, fontWeight: '700', color: '#B91C1C', backgroundColor: '#FEF2F2', padding: 6, borderRadius: 6 },
  big: { borderRadius: 8, paddingVertical: 13, alignItems: 'center' },
  bigText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13, textAlign: 'center' },
  twoRow: { flexDirection: 'row', gap: 8 },
  half: { flex: 1, borderRadius: 8, paddingVertical: 13, paddingHorizontal: 6, alignItems: 'center' },
  center: { borderWidth: 1, borderColor: '#BBF7D0', backgroundColor: '#F0FDF4', borderRadius: 8, padding: 8, gap: 2 },
  centreName: { fontSize: 13, fontWeight: '900', color: '#0F172A' },
  centreLine: { fontSize: 11, color: '#334155' },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
  smallBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1.5, borderColor: '#BFDBFE', backgroundColor: '#EFF6FF', justifyContent: 'center' },
  smallBtnOn: { backgroundColor: '#1D4ED8', borderColor: '#1D4ED8' },
  smallBtnDanger: { borderColor: '#FCA5A5', backgroundColor: '#FFF' },
  smallBtnText: { fontSize: 14, fontWeight: '800', color: '#1D4ED8' },
  link: { fontSize: 12, fontWeight: '800', color: '#1D4ED8' },
  compact: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  compactText: { flex: 1, fontSize: 13, fontWeight: '900', color: '#0F172A' },
  compactOpen: { fontSize: 16, fontWeight: '900', color: '#1D4ED8' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  dialog: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, gap: 8 },
  dialogTitle: { fontSize: 17, fontWeight: '900', color: '#0F172A' },
  dialogSub: { fontSize: 12, color: '#475569' },
  option: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12 },
  optionText: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  input: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#0F172A' },
  tickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  tick: { fontSize: 20, color: '#16A34A' },
});
