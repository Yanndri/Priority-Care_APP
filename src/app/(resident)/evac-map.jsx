import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import OfflineMap from '../../components/offlineMap';
import BottomNav from '../../components/BottomNav';
import { useSession } from '../../components/SessionProvider';
import { HAZARD_OPTIONS } from '../../constants/mockData';
import { FONT_SIZES, FONT_WEIGHTS } from '../../constants/typography';
import { getPublicMap, reportHazard, subscribe } from '../../services/api';
import { getCurrentCoords, distanceMeters } from '../../lib/location';
import { toMapHazard, toMapShelter } from '../../lib/mapData';

// Cordova town centre, used only when the account has no saved home location.
const TOWN_CENTRE = { lat: 10.2546, lng: 123.952 };

export default function ResidentEvacMapScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  // Set when "Show on map" is pressed on a disaster: the map flies to it.
  const disasterFocus = useMemo(() => (params.focusDisasterTs ? {
    key: String(params.focusDisasterTs),
    lat: params.focusDisasterLat ? Number(params.focusDisasterLat) : null,
    lng: params.focusDisasterLng ? Number(params.focusDisasterLng) : null,
    label: params.focusDisasterLabel || 'Disaster',
    note: params.focusDisasterNote || '',
    icon: params.focusDisasterIcon || '⚠️',
    barangay: params.focusDisasterBarangay || '',
  } : null), [params.focusDisasterTs]);
  const { profile } = useSession();
  const resident = profile?.resident || {};
  const homeCoords = resident.gps_lat != null
    ? { lat: Number(resident.gps_lat), lng: Number(resident.gps_long) }
    : TOWN_CENTRE;
  const myHousehold = [{ id: 'home', lat: homeCoords.lat, lng: homeCoords.lng, homeLat: homeCoords.lat, homeLng: homeCoords.lng }];

  const [gpsMode, setGpsMode] = useState('SIMULATED'); // 'REAL' | 'SIMULATED'
  const [isSettingSimGps, setIsSettingSimGps] = useState(false);
  const [userGpsCoords, setUserGpsCoords] = useState(homeCoords);
  const [triggerGpsQuery, setTriggerGpsQuery] = useState(0);
  const [isLocatingGps, setIsLocatingGps] = useState(false);
  const [gpsModalVisible, setGpsModalVisible] = useState(false);

  const [hazards, setHazards] = useState([]);
  const [myReports, setMyReports] = useState([]);
  const [shelters, setShelters] = useState([]);
  const [sending, setSending] = useState(false);
  const [isDroppingHazard, setIsDroppingHazard] = useState(false);
  const [pendingCoords, setPendingCoords] = useState(null);
  const [selectedHazard, setSelectedHazard] = useState(HAZARD_OPTIONS[0]);
  const [hazardNote, setHazardNote] = useState('');

  const distFromHome = distanceMeters(userGpsCoords, homeCoords) || 0;
  const isDisplaced = distFromHome > 35;

  const load = useCallback(async () => {
    try {
      const map = await getPublicMap();
      setHazards((map?.hazards || []).map(toMapHazard));
      setShelters((map?.centers || []).map(toMapShelter));
    } catch {
      // Keep what is already on the map when offline.
    }
  }, []);

  useEffect(() => {
    load();
    const unsubscribe = subscribe(['hazard_reports'], load);
    const timer = setInterval(load, 30000);
    return () => { unsubscribe(); clearInterval(timer); };
  }, [load]);

  // Start from the phone's real position when location is allowed.
  useEffect(() => {
    getCurrentCoords().then((coords) => {
      if (coords) {
        setGpsMode('REAL');
        setUserGpsCoords(coords);
      }
    });
  }, []);

  // Confirmed hazards for everyone, plus this phone's own reports until they are reviewed.
  const shownHazards = [...hazards, ...myReports.filter((r) => !hazards.some((h) => h.id === r.id))];

  const handleGpsFound = (coords) => {
    setIsLocatingGps(false);
    setUserGpsCoords({ lat: coords.lat, lng: coords.lng });
  };

  const handleGpsError = () => {
    setIsLocatingGps(false);
    Alert.alert(
      'Indoor GPS Signal Weak ⚠️',
      'Hardware satellite lock timed out indoors. Switch to Simulated GPS or align with registered home?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Align with Home 🏠',
          onPress: () => {
            setGpsMode('SIMULATED');
            handleGpsFound(homeCoords);
          },
        },
        {
          text: 'Open GPS Simulator 🕹️',
          onPress: () => {
            setGpsMode('SIMULATED');
            setGpsModalVisible(true);
          },
        },
      ]
    );
  };

  const handleBroadcastHazard = async () => {
    if (!hazardNote.trim()) return Alert.alert('Required', 'Please enter a description.');
    setSending(true);
    try {
      const report = await reportHazard({
        type: selectedHazard.id, description: hazardNote.trim(), lat: pendingCoords.lat, lng: pendingCoords.lng,
      });
      setMyReports((prev) => [...prev, toMapHazard({
        hazard_id: report || `local-${Date.now()}`, hazard_type: selectedHazard.id, description: hazardNote.trim(),
        latitude: pendingCoords.lat, longitude: pendingCoords.lng, status: 'unverified',
      })]);
      setPendingCoords(null);
      setHazardNote('');
      Alert.alert(
        'Hazard Pinned ⚠️',
        'Broadcast logged as UNVERIFIED. An active CERT rescuer or MDRRMO marshal will verify this report on-scene.'
      );
    } catch (e) {
      Alert.alert('Hazard not sent', e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <View style={styles.headerTextGroup}>
          <Text style={styles.sub}>CORDOVA EVACUATION ROUTE</Text>
          <Text style={styles.title} numberOfLines={1}>Live Hazard & Safety Map</Text>
        </View>
        <TouchableOpacity
          style={[styles.badgeGps, isDisplaced && { backgroundColor: '#FEF3C7' }]}
          onPress={() => setGpsModalVisible(true)}
        >
          <Text style={[styles.badgeGpsText, isDisplaced && { color: '#B45309' }]}>
            {gpsMode === 'REAL' ? '🛰️ REAL GPS' : '🕹️ SIM GPS'} • {isDisplaced ? `${distFromHome}m AWAY` : 'AT HOME'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.legendBar}>
        <Text style={styles.legendText}>🏠 My Home</Text>
        <Text style={styles.legendText}>🔵 My GPS ({gpsMode})</Text>
        <Text style={styles.legendText}>🟦 Shelter [H]</Text>
      </View>

      {isSettingSimGps && (
        <View style={[styles.dropBanner, { backgroundColor: '#1E3A8A' }]}>
          <Text style={styles.dropText}>🕹️ TAP MAP TO SET YOUR SIMULATED GPS LOCATION</Text>
          <TouchableOpacity onPress={() => setIsSettingSimGps(false)}>
            <Text style={styles.dropCancel}>CANCEL</Text>
          </TouchableOpacity>
        </View>
      )}

      {isDroppingHazard && (
        <View style={styles.dropBanner}>
          <Text style={styles.dropText}>📍 TAP MAP TO SET HAZARD LOCATION</Text>
          <TouchableOpacity onPress={() => setIsDroppingHazard(false)}>
            <Text style={styles.dropCancel}>CANCEL</Text>
          </TouchableOpacity>
        </View>
      )}

      <OfflineMap
        role="resident"
        residents={myHousehold}
        hazards={shownHazards}
        shelters={shelters}
        userGpsCoords={userGpsCoords}
        gpsMode={gpsMode}
        isSettingSimGps={isSettingSimGps}
        isDroppingHazard={isDroppingHazard}
        triggerGpsQuery={triggerGpsQuery}
        focusPoint={disasterFocus}
        onHazardCoordinateDrop={(c) => {
          setIsDroppingHazard(false);
          setPendingCoords(c);
        }}
        onSimGpsCoordinateDrop={(c) => {
          setIsSettingSimGps(false);
          setGpsMode('SIMULATED');
          setUserGpsCoords(c);
        }}
        onGpsLocationFound={handleGpsFound}
        onGpsLocationError={handleGpsError}
      />

      {!isDroppingHazard && !isSettingSimGps && (
        <View style={[styles.fabRow, { bottom: 65 + insets.bottom }]}>
          <TouchableOpacity
            style={[styles.btnGps, gpsMode === 'REAL' && { backgroundColor: '#15803D' }]}
            onPress={() => setGpsModalVisible(true)}
          >
            <Text style={styles.btnText}>
              {isLocatingGps ? '🛰️ LOCATING...' : `📍 GPS (${gpsMode})`}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnHazard} onPress={() => setIsDroppingHazard(true)}>
            <Text style={styles.btnText}>🚨 PIN HAZARD</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Resident GPS Mode Selector Modal */}
      <Modal visible={gpsModalVisible} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.dialog}>
            <Text style={[styles.dialogTitle, { color: '#1E3A8A' }]}>📍 GPS LOCATION SOURCE</Text>
            <Text style={styles.modalSub}>
              Choose real-time device hardware GPS or simulate movement to test away-from-home displacement (35m):
            </Text>

            <View style={{ gap: 8, marginVertical: 10 }}>
              <TouchableOpacity
                style={[styles.optBtn, gpsMode === 'REAL' && styles.optBtnReal]}
                onPress={() => {
                  setGpsMode('REAL');
                  setIsLocatingGps(true);
                  setGpsModalVisible(false);
                  setTriggerGpsQuery(Date.now());
                }}
              >
                <Text style={styles.optTitle}>🛰️ Use Real-Time Hardware GPS</Text>
                <Text style={styles.optSub}>Reads actual smartphone GPS coordinates continuously.</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.optBtn}
                onPress={() => {
                  setGpsMode('SIMULATED');
                  setGpsModalVisible(false);
                  setIsSettingSimGps(true);
                }}
              >
                <Text style={[styles.optTitle, { color: '#1E3A8A' }]}>👆 Tap on Map to Set Simulated Location</Text>
                <Text style={styles.optSub}>Tap any street on the map to move your blue GPS dot.</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.optBtn}
                onPress={() => {
                  setGpsMode('SIMULATED');
                  setUserGpsCoords(homeCoords);
                  setGpsModalVisible(false);
                  setTriggerGpsQuery(Date.now());
                }}
              >
                <Text style={styles.optTitle}>🏠 Preset: Inside My Registered Home (0m)</Text>
                <Text style={styles.optSub}>Snaps blue GPS dot directly onto your registered house pin.</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.optBtn}
                onPress={() => {
                  setGpsMode('SIMULATED');
                  setUserGpsCoords({ lat: 10.2505, lng: 123.9488 });
                  setGpsModalVisible(false);
                  setTriggerGpsQuery(Date.now());
                }}
              >
                <Text style={[styles.optTitle, { color: '#D97706' }]}>🏃 Preset: Displaced at Public Market (~570m away)</Text>
                <Text style={styles.optSub}>Simulates evacuating away from home & draws trajectory line.</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.btnCancelFull} onPress={() => setGpsModalVisible(false)}>
              <Text style={styles.btnCancelText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Hazard Pinning Modal */}
      <Modal visible={Boolean(pendingCoords)} transparent animationType="slide">
        <View style={styles.modalBg}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>REPORT FIELD HAZARD</Text>
            <View style={{ gap: 6, marginVertical: 8 }}>
              {HAZARD_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.optBtn, selectedHazard.id === opt.id && styles.optBtnActive]}
                  onPress={() => setSelectedHazard(opt)}
                >
                  <Text style={styles.optText}>{opt.icon} {opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={styles.input} placeholder="Describe hazard..." value={hazardNote} onChangeText={setHazardNote} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={styles.btnCancel} onPress={() => setPendingCoords(null)}>
                <Text style={styles.btnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnSubmit} onPress={handleBroadcastHazard} disabled={sending}>
                {sending ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnSubmitText}>Broadcast</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <BottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 8, backgroundColor: '#FFF', borderBottomWidth: 1, borderColor: '#E2E8F0' },
  headerTextGroup: { flex: 1, paddingRight: 10 },
  sub: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#64748B' },
  title: { fontSize: FONT_SIZES.subtitle, fontWeight: FONT_WEIGHTS.black, color: '#0F172A' },
  badgeGps: { backgroundColor: '#DCFCE7', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6, flexShrink: 0 },
  badgeGpsText: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#15803D' },
  legendBar: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: '#EFF6FF', paddingVertical: 6, borderBottomWidth: 1, borderColor: '#BFDBFE' },
  legendText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#1E3A8A' },
  dropBanner: { backgroundColor: '#DC2626', flexDirection: 'row', justifyContent: 'space-between', padding: 8 },
  dropText: { color: '#FFF', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, flex: 1, paddingRight: 8 },
  dropCancel: { color: '#FEE2E2', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold },
  fabRow: { position: 'absolute', right: 14, left: 14, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  btnGps: { backgroundColor: '#1E3A8A', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, elevation: 6 },
  btnHazard: { backgroundColor: '#DC2626', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, elevation: 6 },
  btnText: { color: '#FFF', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.black },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 18 },
  dialog: { backgroundColor: '#FFF', borderRadius: 10, padding: 14 },
  dialogTitle: { fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.black, color: '#DC2626' },
  modalSub: { fontSize: FONT_SIZES.tiny, color: '#475569', marginTop: 4 },
  optBtn: { padding: 10, borderRadius: 8, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' },
  optBtnActive: { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' },
  optBtnReal: { backgroundColor: '#F0FDF4', borderColor: '#86EFAC' },
  optTitle: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#0F172A' },
  optSub: { fontSize: FONT_SIZES.tiny, color: '#64748B', marginTop: 2 },
  optText: { fontSize: FONT_SIZES.body },
  input: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 6, padding: 8, fontSize: FONT_SIZES.body, marginVertical: 8 },
  btnCancel: { flex: 1, backgroundColor: '#F1F5F9', padding: 10, borderRadius: 6, alignItems: 'center' },
  btnCancelFull: { backgroundColor: '#F1F5F9', padding: 10, borderRadius: 6, alignItems: 'center', marginTop: 4 },
  btnCancelText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#64748B' },
  btnSubmit: { flex: 1, backgroundColor: '#DC2626', padding: 10, borderRadius: 6, alignItems: 'center' },
  btnSubmitText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#FFF' },
});