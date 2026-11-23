import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Linking, View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, Alert, Image, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import OfflineMap from '../../components/offlineMap';
import { isInCordova, OUTSIDE_CORDOVA_MESSAGE } from '../../lib/cordovaArea';
import BottomNav from '../../components/BottomNav';
import { COLORS } from '../../constants/colors';
import { HAZARD_OPTIONS, RESCUER_DEFAULT_COORDS } from '../../constants/options';
import { useRescuerFeed } from '../../lib/rescuerFeed';
import { formatDistance, getCurrentCoords } from '../../lib/location';
import { useTracker } from '../../lib/rescueTracker';
import RescueCard from '../../components/RescueCard';
import SosDetails from '../../components/SosDetails';
import {
  BACKUP_NEEDS, cancelBackupRequest, getBackupRequests, onLiveSignal, recordEvacuation, reportHazard, withdrawMyHazard, requestBackup,
  reviewHazard, signedPhotoUrl, updateTicketStatus,
} from '../../services/api';
import { getDemoSpot, setDemoSpot, setSharedLocation } from '../../lib/sharedLocation';

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function getEmergencyTheme(emergencyType) {
  const type = String(emergencyType || '').toUpperCase();
  if (type.includes('FLOOD')) {
    return {
      label: 'RISING FLOOD',
      icon: '🌊',
      accentColor: '#0284C7',
      badgeBg: '#E0F2FE',
      badgeBorder: '#BAE6FD',
      badgeText: '#0369A1',
    };
  }
  if (type.includes('FIRE')) {
    return {
      label: 'FIRE',
      icon: '🔥',
      accentColor: '#EA580C',
      badgeBg: '#FFEDD5',
      badgeBorder: '#FED7AA',
      badgeText: '#C2410C',
    };
  }
  if (type.includes('MEDICAL')) {
    return {
      label: 'MEDICAL CRISIS',
      icon: '🚑',
      accentColor: '#DC2626',
      badgeBg: '#FEE2E2',
      badgeBorder: '#FECACA',
      badgeText: '#B91C1C',
    };
  }
  if (type.includes('TRAPPED') || type.includes('DEBRIS')) {
    return {
      label: 'TRAPPED / COLLAPSE',
      icon: '🏚️',
      accentColor: '#D97706',
      badgeBg: '#FEF3C7',
      badgeBorder: '#FDE68A',
      badgeText: '#B45309',
    };
  }
  return {
    label: 'STANDBY HOUSEHOLD',
    icon: '🏠',
    accentColor: '#64748B',
    badgeBg: '#F1F5F9',
    badgeBorder: '#E2E8F0',
    badgeText: '#475569',
  };
}

export default function RescuerMapScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  const feed = useRescuerFeed();
  // Field notes that only live on this phone (no table for them yet).
  const [localNotes, setLocalNotes] = useState({});
  // Open backup requests on my unit's tickets (saved in the database).
  const [backups, setBackups] = useState([]);
  const loadBackups = () => getBackupRequests().then((rows) => setBackups(rows || [])).catch(() => {});
  useEffect(() => {
    loadBackups();
    return onLiveSignal(['tickets'], loadBackups);
  }, []);
  const residents = feed.incidents.map((r) => ({
    ...r, ...localNotes[r.id],
    backups: r.ticketId ? backups.filter((b) => b.ticket_id === r.ticketId) : [],
  }));
  const hazards = feed.hazards;
  const setNote = (id, patch) => setLocalNotes((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const [selectedResident, setSelectedResident] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dossierPhoto, setDossierPhoto] = useState(null);
  const [checkInCenterId, setCheckInCenterId] = useState(null);
  const handledFocus = useRef(null);
  const [selectedBarangay, setSelectedBarangay] = useState(null);
  const [selectedHazardPin, setSelectedHazardPin] = useState(null);

  const [focusedResidentId, setFocusedResidentId] = useState(params.focusResidentId || null);
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
  useEffect(() => {
    if (!disasterFocus) return;
    setFocusedResidentId(null);
    setSelectedResident(null);
    setSelectedHazardPin(null);
    setSelectedBarangay(null);
  }, [disasterFocus]);
  const [showActiveSosOnly, setShowActiveSosOnly] = useState(true);

  // Simulated GPS is a development tool only; release builds always use the phone's GPS.
  const [gpsMode, setGpsMode] = useState(__DEV__ ? 'SIMULATED' : 'REAL');
  const [isSettingSimGps, setIsSettingSimGps] = useState(false);
  const [isLocatingGps, setIsLocatingGps] = useState(false);
  // No made-up position in release builds: the ambulance appears with the first real fix.
  const [rescuerGpsCoords, setRescuerGpsCoords] = useState(__DEV__ ? {
    lat: RESCUER_DEFAULT_COORDS.lat,
    lng: RESCUER_DEFAULT_COORDS.lng,
  } : null);
  // The nearby-hazard check ("Do you see it too?") only uses a real fix or a spot the user picked,
  // never the starting placeholder above (that asked people 10 km away if they could see a fire).
  const [positionKnown, setPositionKnown] = useState(false);
  const placeUnit = (coords) => { setPositionKnown(true); setRescuerGpsCoords(coords); };
  const [missionTarget, setMissionTarget] = useState(null);
  // The rescue card shrinks to one line so the route stays visible.
  const [sheetMin, setSheetMin] = useState(false);
  useEffect(() => { setSheetMin(false); }, [selectedResident?.id]);
  const [triggerGpsQuery, setTriggerGpsQuery] = useState(0);
  const [gpsModalVisible, setGpsModalVisible] = useState(false);

  const [supportModalVisible, setSupportModalVisible] = useState(false);
  const [dossierModalVisible, setDossierModalVisible] = useState(false);

  const [isOffline, setIsOffline] = useState(false);
  const [forceOfflineSim, setForceOfflineSim] = useState(false);
  const [lastSynced, setLastSynced] = useState('Just now');
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  const [isDroppingHazard, setIsDroppingHazard] = useState(false);
  const [pendingCoords, setPendingCoords] = useState(null);
  const [selectedHazard, setSelectedHazard] = useState(HAZARD_OPTIONS[0]);
  const [hazardNote, setHazardNote] = useState('');

  const [checkInModalVisible, setCheckInModalVisible] = useState(false);
  const [checkedMemberIds, setCheckedMemberIds] = useState([]);

  useEffect(() => {
    const focusKey = `${params.focusResidentId}|${params.focusHazardId}|${params.focusTs}`;
    if (handledFocus.current === focusKey || feed.loading) return;
    handledFocus.current = focusKey;
    if (params.focusResidentId) {
      const target = residents.find((r) => r.id === params.focusResidentId);
      if (target) {
        setFocusedResidentId(params.focusResidentId);
        setSelectedResident({ ...target });
        setSelectedHazardPin(null);
        setSelectedBarangay(null);
      }
    } else if (params.focusHazardId) {
      const targetHaz = hazards.find((h) => h.id === params.focusHazardId);
      if (targetHaz) {
        setFocusedResidentId(null);
        setSelectedResident(null);
        setSelectedBarangay(null);
        setSelectedHazardPin({ ...targetHaz });
      }
    }
  }, [params.focusResidentId, params.focusHazardId, params.focusTs, feed.loading]);

  // Keep the open sheet in step with the live feed.
  useEffect(() => {
    setSelectedResident((prev) => {
      if (!prev) return prev;
      const fresh = residents.find((r) => r.id === prev.id);
      return fresh ? { ...prev, ...fresh } : prev;
    });
    setSelectedHazardPin((prev) => (prev ? hazards.find((h) => h.id === prev.id) || null : prev));
  }, [feed.syncedAt, localNotes, backups]);

  // Let the nearby-hazard watcher check from the same spot (phone GPS or demo).
  useEffect(() => { if (positionKnown) setSharedLocation(rescuerGpsCoords); }, [rescuerGpsCoords, positionKnown]);

  // Start from the demo spot picked earlier in this session (so changing screens does not
  // snap back to real GPS); otherwise from the phone's real position when location is allowed.
  useEffect(() => {
    const demo = getDemoSpot();
    if (demo) {
      setGpsMode('SIMULATED');
      placeUnit(demo);
      return;
    }
    getCurrentCoords().then((coords) => {
      if (coords && !getDemoSpot()) {
        setGpsMode('REAL');
        placeUnit(coords);
      }
    });
  }, []);

  // Remember a demo spot for other screens; choosing real GPS forgets it.
  useEffect(() => {
    if (gpsMode === 'REAL') setDemoSpot(null);
    else if (positionKnown) setDemoSpot(rescuerGpsCoords);
  }, [gpsMode, positionKnown, rescuerGpsCoords]);

  // While this map is open, follow the phone as it moves so your marker and the
  // route stay current. The position stays on this phone (nothing is sent).
  const [mapFocused, setMapFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setMapFocused(true);
    return () => setMapFocused(false);
  }, []));
  const tracker = useTracker({ active: mapFocused });
  useEffect(() => {
    if (!tracker.fix) return;
    if (gpsMode !== 'REAL' && __DEV__) return; // a developer placed the unit by hand
    if (gpsMode !== 'REAL') setGpsMode('REAL');
    placeUnit({ lat: tracker.fix.lat, lng: tracker.fix.lng });
  }, [tracker.fix, gpsMode]);

  useEffect(() => {
    let alive = true;
    setDossierPhoto(null);
    signedPhotoUrl('house-facades', selectedResident?.housePhotoPath).then((url) => alive && setDossierPhoto(url));
    return () => { alive = false; };
  }, [selectedResident?.housePhotoPath]);

  // Runs a database write, then refreshes the feed. Returns false when it failed.
  const run = async (fn, failTitle = 'Not saved') => {
    setBusy(true);
    try {
      await fn();
      await feed.reload();
      return true;
    } catch (e) {
      Alert.alert(failTitle, e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (forceOfflineSim) {
      setIsOffline(true);
      return;
    }
    let isMounted = true;
    const checkNet = async () => {
      try {
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 2500);
        const res = await fetch('https://clients3.google.com/generate_204', { method: 'HEAD', signal: ctrl.signal });
        const offlineNow = !res.ok && res.status !== 204;
        if (isMounted) {
          setIsOffline(offlineNow);
          if (!offlineNow) {
            const now = new Date();
            setLastSynced(`${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`);
            setPendingSyncCount(0);
          }
        }
      } catch {
        if (isMounted) setIsOffline(true);
      }
    };
    checkNet();
    const timer = setInterval(checkNet, 5000);
    return () => { isMounted = false; clearInterval(timer); };
  }, [forceOfflineSim]);

  const handleGpsLocationFound = (coords) => {
    setIsLocatingGps(false);
    placeUnit({ lat: coords.lat, lng: coords.lng });
  };

  const handleGpsLocationError = () => {
    setIsLocatingGps(false);
    if (!__DEV__) {
      return Alert.alert('GPS signal weak ⚠️', 'Could not get a satellite fix. Move to an open area; your last known position stays on the map.');
    }
    Alert.alert('GPS signal weak ⚠️', 'Could not get your location. Use a demo location instead?', [
      { text: 'Keep Trying', style: 'cancel' },
      {
        text: 'Use demo location 🕹️',
        onPress: () => {
          setGpsMode('SIMULATED');
          setGpsModalVisible(true);
        },
      },
    ]);
  };

  // 1. Verify Ground Truth
  const handleVerifySelectedHazard = async (haz) => {
    if (await run(() => reviewHazard(haz.id, 'confirm', 'Confirmed on site by a responder'))) {
      Alert.alert('Confirmed ✅', 'Marked as confirmed on every map.');
    }
  };

  // 2. Undo Hazard Verification (back to "needs checking")
  const handleUndoHazardVerification = (haz) => {
    Alert.alert(
      'Undo? ↩️',
      haz.clearanceRequested
        ? 'Withdraw your clearance report? The hazard goes back to confirmed.'
        : `Set this ${haz.type} report back to not confirmed?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Undo',
          style: 'destructive',
          onPress: () => run(() => (haz.clearanceRequested
            ? reviewHazard(haz.id, 'confirm', 'Responder withdrew the cleared report')
            : reviewHazard(haz.id, 'review', 'Responder undid the confirmation'))),
        },
      ]
    );
  };

  // 3. Relay Road Cleared to EOC (does not remove the pin; the EOC resolves it on the web)
  const handleRelayClearanceToEoc = (haz) => {
    if (haz.clearanceRequested) return Alert.alert('Already sent', 'The MDRRMO already has your report and will remove the pin.');
    Alert.alert(
      'Mark road as cleared? 📡',
      `Tell the MDRRMO that the ${haz.type} is cleared? They will check and remove the pin.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            if (await run(() => reviewHazard(haz.id, 'review', 'Cleared on site by a responder; waiting for the MDRRMO to remove it'))) {
              Alert.alert('Sent 📡', 'The MDRRMO will check and remove the pin.');
            }
          },
        },
      ]
    );
  };

  // 4. Report False Alarm (dismisses the report; it leaves every map)
  const handleFlagHazardFalse = (haz) => {
    Alert.alert(
      'Mark as false report? 🚫',
      `You checked and there is no ${haz.type} here? The report will be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'No, false report',
          style: 'destructive',
          onPress: async () => {
            if (await run(() => reviewHazard(haz.id, 'dismiss', 'False alarm: no hazard found on scene'))) {
              setSelectedHazardPin(null);
              Alert.alert('Removed 📡', 'Saved as a false report and taken off the map.', [
                { text: 'Undo', onPress: () => run(() => reviewHazard(haz.id, 'review', 'Responder undid the false-report mark')) },
                { text: 'OK' },
              ]);
            }
          },
        },
      ]
    );
  };

  const nearestCenterId = (res) => {
    let best = null;
    feed.centers.forEach((c) => {
      const d = getDistanceMeters(res.lat, res.lng, c.lat, c.lng);
      if (c.occupied < c.capacity && (best === null || d < best.d)) best = { id: c.id, d };
    });
    return best?.id ?? feed.centers[0]?.id ?? null;
  };

  const openCheckIn = (res) => {
    setCheckedMemberIds((res.members || []).map((m) => m.id));
    setCheckInCenterId(nearestCenterId(res));
    setCheckInModalVisible(true);
  };

  const handleInitiatePreEmptiveEvac = (res) => {
    Alert.alert(
      'Evacuate early 🚶',
      `Bring ${res.name}'s household (priority score ${res.vpiScore}) to their evacuation center?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Start', onPress: () => openCheckIn(res) },
      ]
    );
  };

  // Backup requests are saved on the ticket; the website shows them to the MDRRMO.
  const handleSendSupportRequest = async (need) => {
    setSupportModalVisible(false);
    if (!selectedResident?.ticketId || !selectedResident.isMine) {
      return Alert.alert('Not assigned to your unit', 'Only the unit assigned to this SOS can ask for backup.');
    }
    try {
      setBusy(true);
      await requestBackup(selectedResident.ticketId, need);
      await loadBackups();
      Alert.alert('Backup requested 📡', `${BACKUP_NEEDS[need].label} for ${selectedResident.name}. The MDRRMO sees it on the website now.`);
    } catch (e) {
      Alert.alert('Not sent', e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCancelSupportRequest = (request) => {
    Alert.alert(
      'Cancel backup request? 🛑',
      `Cancel the request for ${BACKUP_NEEDS[request.need]?.label || request.need}?`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel request', style: 'destructive',
          onPress: async () => {
            try { await cancelBackupRequest(request.request_id); await loadBackups(); }
            catch (e) { Alert.alert('Not canceled', e.message); }
          },
        },
      ]
    );
  };

  const handleConfirmShelterCheckIn = async () => {
    if (!selectedResident) return;
    const center = feed.centers.find((c) => c.id === checkInCenterId);
    if (!center) return Alert.alert('Choose an evacuation center', 'Pick the evacuation center the household was brought to.');
    const res = selectedResident;
    const members = res.members || [];
    const admitted = members.filter((m) => checkedMemberIds.includes(m.id)).length;
    const ok = await run(async () => {
      for (const m of members) {
        const person = m.kind === 'resident' ? { kind: 'resident', uid: m.uid } : { kind: 'member', member_id: m.member_id };
        await recordEvacuation(person, center.id, checkedMemberIds.includes(m.id) ? 'safely_evacuated' : 'failed');
      }
      if (res.ticketId) {
        await updateTicketStatus(res.ticketId, 'resolved',
          `Evacuated to ${center.name}: ${members.length ? `${admitted}/${members.length}` : res.householdSize} admitted`);
      }
    }, 'Check-in not saved');
    if (!ok) return;
    setSelectedResident({
      ...res,
      status: 'EVACUATED',
      sosActive: false,
      members: members.map((m) => (checkedMemberIds.includes(m.id)
        ? { ...m, status: 'ADMITTED', shelter: center.name }
        : { ...m, status: 'NOT REACHED', shelter: 'Not found at pickup' })),
      evacuatedTo: `${center.name} (${members.length ? `${admitted}/${members.length}` : res.householdSize} checked in)`,
      color: '#16A34A',
    });
    setCheckInModalVisible(false);
  };

  const toggleMemberCheck = (id) => {
    setCheckedMemberIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleBroadcastHazard = async () => {
    if (!hazardNote.trim()) return Alert.alert('Required', 'Please add a short note.');
    let newId = null;
    const ok = await run(async () => {
      newId = await reportHazard({
        type: selectedHazard.id, description: hazardNote.trim(), lat: pendingCoords.lat, lng: pendingCoords.lng,
      });
    }, 'Hazard not sent');
    if (ok) {
      setPendingCoords(null);
      setHazardNote('');
      if (newId) {
        Alert.alert('Hazard reported ⚠️', 'Made a mistake? You can take it back now.', [
          { text: 'Take it back', style: 'destructive', onPress: () => run(() => withdrawMyHazard(newId), 'Could not take it back') },
          { text: 'OK' },
        ]);
      }
    }
  };

  const sheetBottomOffset = 64 + insets.bottom;
  let displayedPins = residents;
  if (focusedResidentId) {
    displayedPins = residents.filter((r) => r.id === focusedResidentId);
  } else if (showActiveSosOnly) {
    displayedPins = residents.filter((r) => r.sosActive);
  }

  const selectedDistFromHome = selectedResident
    ? getDistanceMeters(selectedResident.lat, selectedResident.lng, selectedResident.homeLat, selectedResident.homeLng)
    : 0;
  const selectedDistFromRescuer = selectedResident && rescuerGpsCoords
    ? getDistanceMeters(rescuerGpsCoords.lat, rescuerGpsCoords.lng, selectedResident.lat, selectedResident.lng)
    : 0;
  const hazardDistFromRescuer = selectedHazardPin && rescuerGpsCoords
    ? getDistanceMeters(rescuerGpsCoords.lat, rescuerGpsCoords.lng, selectedHazardPin.lat, selectedHazardPin.lng)
    : 0;

  const isResidentCritical =
    selectedResident && selectedResident.sosActive && (selectedResident.priority === 'CRITICAL' || selectedResident.vpiScore >= 80);

  const emergencyTheme = getEmergencyTheme(selectedResident?.emergencyType);

  const dossierMembers = selectedResident?.members || [];
  const totalSouls = dossierMembers.length;
  const childCount = dossierMembers.filter((m) => m.category === 'child').length;
  const seniorCount = dossierMembers.filter((m) => m.category === 'senior').length;
  const pregnantCount = dossierMembers.filter((m) => m.category === 'pregnant').length;
  const pwdCount = dossierMembers.filter(
    (m) => m.mobility === 'non' || m.mobility === 'wheelchair' || m.mobility === 'semi'
  ).length;

  return (
    <View style={styles.container}>
      {/* Floating Status Pill */}
      <View style={[styles.floatingTopBar, { top: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.statusPill}
          onPress={() => {
            const nextOffline = !forceOfflineSim;
            setForceOfflineSim(nextOffline);
            setIsOffline(nextOffline);
            Alert.alert(
              nextOffline ? 'Offline view 📡' : 'Back online 🌐',
              nextOffline
                ? 'This is what the map shows with no signal: the saved offline map and the last downloaded SOS, resident and hazard data. Tap the bar again to go back online.'
                : 'Showing live data again.'
            );
          }}
          activeOpacity={0.8}
        >
          <View style={[styles.statusDot, { backgroundColor: isOffline ? '#DC2626' : '#16A34A' }]} />
          <Text style={styles.statusText}>
            {isOffline && forceOfflineSim
              ? 'OFFLINE VIEW • SAVED DATA • TAP TO GO BACK'
              : isOffline
              ? 'NO SIGNAL • SAVED DATA'
              : feed.error && feed.fromCache
              ? `NO SIGNAL • SAVED DATA FROM ${lastSynced}`
              : feed.error
              ? 'SERVER UNREACHABLE • RETRYING'
              : feed.loading
              ? 'LOADING…'
              : `SYNCED ${lastSynced} • ${residents.filter((r) => r.isMine).length} ASSIGNED TO ME`}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Focused Incident Reset Banner */}
      {focusedResidentId && selectedResident && (
        <View style={[styles.focusBanner, { top: insets.top + 44 }]}>
          <Text style={styles.focusBannerText} numberOfLines={1}>
            🎯 SHOWING: {selectedResident.name.toUpperCase()}
          </Text>
          <TouchableOpacity
            style={styles.btnResetFocus}
            onPress={() => {
              setFocusedResidentId(null);
              setSelectedResident(null);
            }}
          >
            <Text style={styles.btnResetFocusText}>Show All ✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Mode Banners */}
      {isSettingSimGps && (
        <View style={[styles.dropBanner, { top: insets.top + 8, backgroundColor: '#0284C7' }]}>
          <Text style={styles.dropBannerText}>🕹️ DEMO: TAP MAP TO SET YOUR LOCATION</Text>
          <TouchableOpacity onPress={() => setIsSettingSimGps(false)}>
            <Text style={styles.dropCancelText}>CANCEL</Text>
          </TouchableOpacity>
        </View>
      )}

      {isDroppingHazard && (
        <View style={[styles.dropBanner, { top: insets.top + 8 }]}>
          <Text style={styles.dropBannerText}>📍 TAP THE MAP WHERE THE HAZARD IS</Text>
          <TouchableOpacity onPress={() => setIsDroppingHazard(false)}>
            <Text style={styles.dropCancelText}>CANCEL</Text>
          </TouchableOpacity>
        </View>
      )}

      <OfflineMap
        role="rescuer"
        residents={displayedPins}
        hazards={hazards}
        shelters={feed.centers}
        gpsLabel={feed.me?.unitLabel}
        userGpsCoords={rescuerGpsCoords}
        gpsMode={gpsMode}
        isSettingSimGps={isSettingSimGps}
        triggerGpsQuery={triggerGpsQuery}
        isOffline={isOffline}
        isDroppingHazard={isDroppingHazard}
        selectedBarangay={selectedBarangay}
        selectedResident={selectedResident}
        selectedHazardPin={selectedHazardPin}
        focusPoint={disasterFocus}
        missionTarget={missionTarget}
        onPinSelect={(res) => {
          setSelectedBarangay(null);
          setSelectedHazardPin(null);
          setSelectedResident(res);
        }}
        onHazardPinSelect={(haz) => {
          setSelectedBarangay(null);
          setSelectedResident(null);
          setSelectedHazardPin(haz);
        }}
        onHazardCoordinateDrop={(coords) => {
          setIsDroppingHazard(false);
          if (!isInCordova(coords.lat, coords.lng)) {
            Alert.alert('Outside Cordova', OUTSIDE_CORDOVA_MESSAGE);
            return;
          }
          setPendingCoords(coords);
        }}
        onSimGpsCoordinateDrop={(coords) => {
          setIsSettingSimGps(false);
          setGpsMode('SIMULATED');
          placeUnit(coords);
          setTriggerGpsQuery(Date.now());
        }}
        onGpsLocationFound={handleGpsLocationFound}
        onGpsLocationError={handleGpsLocationError}
        onMapClick={() => {
          setSelectedBarangay(null);
          setSelectedResident(null);
          setSelectedHazardPin(null);
          setFocusedResidentId(null); // closing a resident opened from the SOS list shows everything again
        }}
      />

      {/* Floating Bottom Controls */}
      {!isDroppingHazard && !isSettingSimGps && !selectedResident && !selectedBarangay && !selectedHazardPin && (
        <>
          <TouchableOpacity
            style={[
              styles.floatingFilter,
              { bottom: sheetBottomOffset + 12 },
              showActiveSosOnly ? styles.filterActiveSos : styles.filterAll,
            ]}
            onPress={() => setShowActiveSosOnly(!showActiveSosOnly)}
            activeOpacity={0.85}
          >
            <Text style={[styles.floatingFilterText, showActiveSosOnly ? styles.filterTextSos : styles.filterTextAll]}>
              {showActiveSosOnly
                ? `🚨 SOS (${residents.filter((r) => r.sosActive).length})`
                : `🌐 All (${residents.length})`}
            </Text>
          </TouchableOpacity>

          <View style={[styles.fabStack, { bottom: sheetBottomOffset + 12 }]}>
            <TouchableOpacity
              style={[styles.circleFab, gpsMode === 'REAL' ? styles.fabGpsReal : styles.fabGpsSim]}
              onPress={() => {
                if (gpsMode === 'REAL') setIsLocatingGps(true);
                setTriggerGpsQuery(Date.now());
              }}
              onLongPress={() => setGpsModalVisible(true)}
              activeOpacity={0.8}
            >
              <Text style={styles.circleFabIcon}>{isLocatingGps ? '⏳' : '🎯'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.hazardFab}
              onPress={() => {
                setSelectedBarangay(null);
                setIsDroppingHazard(true);
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.hazardFabText}>🚨 REPORT HAZARD</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Controlled Hazard Bottom Sheet (Strict EOC Resolution + Undo) */}
      {selectedHazardPin && !selectedResident && !selectedBarangay && (
        <View style={[styles.actionSheet, { bottom: sheetBottomOffset }]}>
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={styles.sheetName}>
                  {selectedHazardPin.icon} {selectedHazardPin.type} ALERT
                </Text>
                {selectedHazardPin.verificationStatus === 'CONFIRMED' ? (
                  <View style={[styles.verifBadge, styles.verifBadgeConfirmed]}>
                    <Text style={styles.verifTextConfirmed}>✓ CONFIRMED</Text>
                  </View>
                ) : selectedHazardPin.verificationStatus === 'FLAGGED_FALSE' ? (
                  <View style={[styles.verifBadge, { backgroundColor: '#F1F5F9', borderColor: '#CBD5E1' }]}>
                    <Text style={{ color: '#64748B', fontSize: 9, fontWeight: '900' }}>🚫 FLAGGED FALSE</Text>
                  </View>
                ) : (
                  <View style={[styles.verifBadge, styles.verifBadgeUnverified]}>
                    <Text style={styles.verifTextUnverified}>⚠️ UNVERIFIED</Text>
                  </View>
                )}
              </View>
              <Text style={styles.sheetSitio}>
                Brgy. {selectedHazardPin.barangay} • 📍 {rescuerGpsCoords ? `${hazardDistFromRescuer} m from you` : 'waiting for GPS'}
              </Text>
              <Text style={styles.hazardDescriptionText}>{selectedHazardPin.description}</Text>
              <Text style={styles.reportedByText}>
                Reported by {selectedHazardPin.reportedBy} ({selectedHazardPin.time})
                {selectedHazardPin.verifiedBy ? ` • ${selectedHazardPin.verifiedBy}` : ''}
              </Text>
              {selectedHazardPin.reporterContact && (
                <TouchableOpacity onPress={() => Linking.openURL(`tel:${selectedHazardPin.reporterContact}`)} accessibilityRole="button">
                  <Text style={styles.callReporterText}>📞 Call the reporter to check</Text>
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity onPress={() => setSelectedHazardPin(null)}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Tactical Verification & Relay Actions */}
          <View style={{ marginTop: 8 }}>
            {selectedHazardPin.verificationStatus === 'UNVERIFIED' ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={[styles.btnStatus, { backgroundColor: '#15803D', flex: 1.5 }]}
                  onPress={() => handleVerifySelectedHazard(selectedHazardPin)}
                >
                  <Text style={styles.btnStatusText}>✓ Yes, it's real</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btnFalseReport, { flex: 1 }]}
                  onPress={() => handleFlagHazardFalse(selectedHazardPin)}
                >
                  <Text style={styles.btnFalseReportText}>✕ No, false report</Text>
                </TouchableOpacity>
              </View>
            ) : selectedHazardPin.verificationStatus === 'CONFIRMED' ? (
              <View style={{ gap: 6 }}>
                {/* Clearance Relay (Does not delete pin; sends SITREP to EOC) */}
                <TouchableOpacity
                  style={[
                    styles.btnStatus,
                    { backgroundColor: selectedHazardPin.clearanceRequested ? '#0284C7' : '#1E3A8A' },
                  ]}
                  onPress={() => handleRelayClearanceToEoc(selectedHazardPin)}
                >
                  <Text style={styles.btnStatusText}>
                    {selectedHazardPin.clearanceRequested
                      ? '⏳ CLEARED REPORT SENT • WAITING FOR MDRRMO'
                      : '📡 MARK ROAD AS CLEARED'}
                  </Text>
                </TouchableOpacity>

                {/* Undo Button */}
                <TouchableOpacity
                  style={styles.btnUndo}
                  onPress={() => handleUndoHazardVerification(selectedHazardPin)}
                >
                  <Text style={styles.btnUndoText}>↩️ Undo (back to not checked)</Text>
                </TouchableOpacity>
              </View>
            ) : (
              /* FLAGGED_FALSE State */
              <View style={{ gap: 4 }}>
                <View style={[styles.evacuatedBanner, { backgroundColor: '#F1F5F9' }]}>
                  <Text style={{ color: '#64748B', fontWeight: '900', fontSize: 10.5 }}>
                    🚫 MARKED AS FALSE • WAITING FOR MDRRMO
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.btnUndo}
                  onPress={() => handleUndoHazardVerification(selectedHazardPin)}
                >
                  <Text style={styles.btnUndoText}>↩️ Undo (back to not checked)</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Streamlined Resident Bottom Sheet */}
      {selectedResident && !selectedBarangay && (
        <View
          style={[
            styles.actionSheet,
            { bottom: sheetBottomOffset, borderLeftColor: emergencyTheme.accentColor },
          ]}
        >
          {!sheetMin && (<>
          {/* Row 1: Resident Name, Priority Badge, Distance & Dossier Pill */}
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <View style={styles.nameRow}>
                <Text style={styles.sheetName}>{selectedResident.name}</Text>
                {selectedResident.accountUnverified && (
                  <View style={styles.badgeUnverified}>
                    <Text style={styles.badgeUnverifiedText}>ACCOUNT NOT VERIFIED</Text>
                  </View>
                )}
                {isResidentCritical ? (
                  <View style={styles.badgeCritical}>
                    <Text style={styles.badgeCriticalText}>🚨 CRITICAL</Text>
                  </View>
                ) : (
                  <View style={styles.badgeNormal}>
                    <Text style={styles.badgeNormalText}>VPI {selectedResident.vpiScore || 50}</Text>
                  </View>
                )}
                <Text style={styles.timeTag}>📍 {rescuerGpsCoords ? `${formatDistance(Math.round(selectedDistFromRescuer))} away (straight line)` : 'waiting for GPS'}</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <TouchableOpacity
                style={styles.btnDossierPill}
                onPress={() => setDossierModalVisible(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.btnDossierPillText}>👥 {totalSouls} • Info ➔</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setSelectedResident(null); setFocusedResidentId(null); }} hitSlop={8}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Row 2: Emergency Badge + Static Registered Address & Displacement Tag */}
          <View style={styles.incidentBadgeRow}>
            {selectedResident.sosActive ? (
              <View
                style={[
                  styles.distinctEmergencyBadge,
                  { backgroundColor: emergencyTheme.badgeBg, borderColor: emergencyTheme.badgeBorder },
                ]}
              >
                <Text style={[styles.distinctEmergencyText, { color: emergencyTheme.badgeText }]}>
                  {emergencyTheme.icon} {emergencyTheme.label}
                </Text>
              </View>
            ) : (
              <View style={[styles.distinctEmergencyBadge, { backgroundColor: '#F1F5F9', borderColor: '#E2E8F0' }]}>
                <Text style={[styles.distinctEmergencyText, { color: '#64748B' }]}>
                  🏠 NO SOS
                </Text>
              </View>
            )}

            <View style={styles.locationMetaCol}>
              <Text style={styles.addressText}>
                Brgy. {selectedResident.barangay} • {selectedResident.sitio}
              </Text>
              {selectedResident.lat != null && selectedResident.lng != null && !isInCordova(Number(selectedResident.lat), Number(selectedResident.lng)) && (
                <Text style={styles.displacedNoticeText}>
                  ⚠️ Outside Cordova: the MDRRMO coordinates with that town
                </Text>
              )}
              {selectedResident.homeKnown === false ? null : selectedDistFromHome > 35 ? (
                <Text style={styles.displacedNoticeText}>
                  🏃 Away from home ({formatDistance(Math.round(selectedDistFromHome))})
                </Text>
              ) : (
                <Text style={styles.atHomeNoticeText}>
                  🏠 At home
                </Text>
              )}
            </View>
          </View>

          {/* Row 3: What to bring & landmark */}
          <View style={styles.tacticalInfoBox}>
            <View style={{ flex: 1, paddingRight: 6 }}>
              {selectedResident.isMine && (
                <Text style={styles.tacticalNoteText} numberOfLines={3}>
                  📝 {selectedResident.note
                    ? <Text style={{ fontWeight: '800', color: '#0F172A' }}>"{selectedResident.note}"</Text>
                    : <Text style={{ fontStyle: 'italic', color: '#94A3B8' }}>No note from the resident</Text>}
                </Text>
              )}
              {selectedResident.instructions ? (
                <Text style={styles.tacticalNoteText} numberOfLines={2}>📋 MDRRMO: {selectedResident.instructions}</Text>
              ) : null}
              <Text style={styles.tacticalGearText}>
                🎒 <Text style={{ fontWeight: '900', color: '#0F172A' }}>{selectedResident.requiredGear}</Text>
              </Text>
              {selectedResident.landmark ? (
                <Text style={styles.tacticalLandmarkText}>
                  🚩 {selectedResident.landmark}
                </Text>
              ) : null}
            </View>

          </View>

          {/* Backup requests (open ones, saved in the database) */}
          {selectedResident.backups?.map((b) => (
            <View key={b.request_id} style={styles.supportBanner}>
              <View style={{ flex: 1 }}>
                <Text style={styles.supportBannerType} numberOfLines={1}>
                  📡 Backup asked: {BACKUP_NEEDS[b.need]?.icon} {BACKUP_NEEDS[b.need]?.label || b.need}
                </Text>
              </View>
              <TouchableOpacity onPress={() => handleCancelSupportRequest(b)}>
                <Text style={styles.btnSupportCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ))}

          </>)}

          {/* Row 4: Main action */}
          <View style={{ marginTop: sheetMin ? 0 : 8 }}>
            {!selectedResident.sosActive ? (
              <TouchableOpacity
                style={styles.btnPreEmptive}
                onPress={() => handleInitiatePreEmptiveEvac(selectedResident)}
                activeOpacity={0.85}
              >
                <Text style={styles.btnPreEmptiveText}>🚶 Log Pre-Emptive Evacuation</Text>
              </TouchableOpacity>
            ) : selectedResident.status === 'EVACUATED' ? (
              <View style={styles.evacuatedBanner}>
                <Text style={styles.evacuatedText}>✓ {selectedResident.evacuatedTo}</Text>
              </View>
            ) : selectedResident.status === 'FALSE_REPORT' ? (
              <View style={[styles.evacuatedBanner, { backgroundColor: '#F1F5F9' }]}>
                <Text style={{ color: '#64748B', fontWeight: '900', fontSize: 11 }}>🚫 FALSE REPORT CLOSED</Text>
              </View>
            ) : (
              <>
                {selectedResident.sosCancelled && !sheetMin && (
                  <View style={[styles.evacuatedBanner, { backgroundColor: '#FEF3C7', marginBottom: 6 }]}>
                    <Text style={{ color: '#B45309', fontWeight: '900', fontSize: 10.5 }}>
                      ⚠️ RESIDENT CANCELED THE SOS ({String(selectedResident.cancelReason || '').replace('_', ' ').toUpperCase()}) • CHECK ON SITE, THEN CLOSE
                    </Text>
                  </View>
                )}
                {selectedResident.isMine && selectedResident.ticketId ? (
                  <RescueCard
                    key={selectedResident.ticketId}
                    res={selectedResident}
                    unitPos={positionKnown ? rescuerGpsCoords : null}
                    compact={sheetMin}
                    onCompact={setSheetMin}
                    onTarget={setMissionTarget}
                    onBackup={() => setSupportModalVisible(true)}
                    onClosed={() => {
                      setMissionTarget(null);
                      feed.reload();
                      setSelectedResident(null);
                      setFocusedResidentId(null);
                    }}
                  />
                ) : (
                  <View style={[styles.evacuatedBanner, { backgroundColor: '#F1F5F9' }]}>
                    <Text style={{ color: '#475569', fontWeight: '900', fontSize: 11 }}>
                      {selectedResident.assignedUnit ? '🚑 HANDLED BY ANOTHER UNIT' : '⏳ WAITING FOR THE MDRRMO TO ASSIGN A UNIT'}
                    </Text>
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      )}

      {/* Household details modal */}
      <Modal visible={dossierModalVisible} transparent animationType="slide">
        <View style={styles.dossierBackdrop}>
          <View style={[styles.dossierCard, { maxHeight: '88%' }]}>
            <View style={styles.dossierHeaderRow}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.dossierSuperTitle}>HOUSEHOLD DETAILS</Text>
                <Text style={styles.dossierName}>{selectedResident?.name}</Text>
                <Text style={styles.dossierSubLocation}>
                  Brgy. {selectedResident?.barangay} • {selectedResident?.sitio}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.dossierCloseBtn}
                onPress={() => setDossierModalVisible(false)}
              >
                <Text style={styles.dossierCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.dossierScroll} showsVerticalScrollIndicator={false}>
              <View style={styles.facadeSection}>
                {dossierPhoto ? (
                  <Image source={{ uri: dossierPhoto }} style={styles.facadeLargeImg} resizeMode="cover" />
                ) : (
                  <View style={[styles.facadeLargeImg, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F5F9' }]}>
                    <Text style={{ color: '#64748B', fontWeight: '800' }}>🏠 No house photo on file</Text>
                  </View>
                )}
                <View style={styles.landmarkBanner}>
                  <Text style={styles.landmarkBannerTitle}>🚩 LANDMARK:</Text>
                  <Text style={styles.landmarkBannerText}>
                    {selectedResident?.landmark || 'No landmark given.'}
                  </Text>
                </View>
              </View>

              {selectedResident?.sosActive && (
                <SosDetails res={selectedResident} style={{ marginBottom: 12 }} />
              )}

              <Text style={styles.dossierSecHeader}>WHO LIVES HERE</Text>
              <View style={styles.tallyGrid}>
                <View style={[styles.tallyBox, { borderColor: '#BFDBFE', backgroundColor: '#EFF6FF' }]}>
                  <Text style={[styles.tallyNum, { color: '#1E3A8A' }]}>{totalSouls}</Text>
                  <Text style={styles.tallyLabel}>PEOPLE</Text>
                </View>
                <View style={[styles.tallyBox, { borderColor: '#BBF7D0', backgroundColor: '#F0FDF4' }]}>
                  <Text style={[styles.tallyNum, { color: '#16A34A' }]}>{childCount}</Text>
                  <Text style={styles.tallyLabel}>CHILDREN</Text>
                </View>
                <View style={[styles.tallyBox, { borderColor: '#FDE68A', backgroundColor: '#FFFBEB' }]}>
                  <Text style={[styles.tallyNum, { color: '#B45309' }]}>{seniorCount}</Text>
                  <Text style={styles.tallyLabel}>SENIORS</Text>
                </View>
                <View style={[styles.tallyBox, { borderColor: '#FECACA', backgroundColor: '#FEF2F2' }]}>
                  <Text style={[styles.tallyNum, { color: '#DC2626' }]}>{pwdCount}</Text>
                  <Text style={styles.tallyLabel}>BEDRIDDEN / PWD</Text>
                </View>
              </View>

              {pregnantCount > 0 && (
                <View style={styles.pregnantAlertBadge}>
                  <Text style={styles.pregnantAlertText}>
                    🤰 {pregnantCount} pregnant member(s)
                  </Text>
                </View>
              )}

              <Text style={[styles.dossierSecHeader, { marginTop: 12 }]}>HOUSE & LOCATION</Text>
              <View style={styles.infoRowCard}>
                <View style={styles.infoItem}>
                  <Text style={styles.infoItemLabel}>HOUSE TYPE</Text>
                  <Text style={styles.infoItemValue}>{[selectedResident?.houseType, selectedResident?.floorLevel].filter(Boolean).join(' • ') || '—'}</Text>
                </View>
                <View style={styles.infoDivider} />
                <View style={styles.infoItem}>
                  <Text style={styles.infoItemLabel}>PRIORITY SCORE</Text>
                  <Text style={[styles.infoItemValue, { color: '#DC2626' }]}>
                    {selectedResident?.vpiScore || 65} ({selectedResident?.priority || 'NORMAL'})
                  </Text>
                </View>
                <View style={styles.infoDivider} />
                <View style={styles.infoItem}>
                  <Text style={styles.infoItemLabel}>HOME GPS</Text>
                  <Text style={styles.infoItemValue}>
                    {selectedResident?.homeLat?.toFixed(4)}, {selectedResident?.homeLng?.toFixed(4)}
                  </Text>
                </View>
              </View>

              <Text style={[styles.dossierSecHeader, { marginTop: 12 }]}>EMERGENCY CONTACT PHONE</Text>
              <View style={styles.contactRowCard}>
                <Text style={styles.contactNumberText}>
                  📞 Primary: {selectedResident?.contact || 'Not on file'}
                </Text>
                {selectedResident?.contact2 && (
                  <Text style={styles.contactNumberSub}>📞 Secondary: {selectedResident.contact2}</Text>
                )}
              </View>

              <Text style={[styles.dossierSecHeader, { marginTop: 12 }]}>
                HOUSEHOLD MEMBERS ({totalSouls})
              </Text>
              <View style={{ gap: 6, marginBottom: 14 }}>
                {dossierMembers.map((member, idx) => (
                  <View key={member.id || idx} style={styles.memberDossierRow}>
                    <View style={{ flex: 1, paddingRight: 6 }}>
                      <Text style={styles.memberDossierName}>{member.name}</Text>
                      <Text style={styles.memberDossierRole}>
                        {member.role || `${member.category || 'Adult'} • ${member.mobility || 'Ambulatory'}`}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.memberDossierBadge,
                        member.status === 'MISSING'
                          ? styles.dossierBgMissing
                          : member.status === 'ADMITTED'
                          ? styles.dossierBgAdmitted
                          : styles.dossierBgNeutral,
                      ]}
                    >
                      <Text
                        style={[
                          styles.memberDossierBadgeText,
                          member.status === 'MISSING' && { color: '#DC2626' },
                          member.status === 'ADMITTED' && { color: '#16A34A' },
                        ]}
                      >
                        {member.status || 'AT RESIDENCE'}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>

            <TouchableOpacity
              style={styles.btnCloseDossierModal}
              onPress={() => setDossierModalVisible(false)}
            >
              <Text style={styles.btnCloseDossierModalText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Requisition Modal */}
      <Modal visible={supportModalVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.dialog}>
            <Text style={[styles.dialogTitle, { color: '#DC2626' }]}>🚨 REQUEST BACKUP</Text>
            <Text style={styles.checkInSub}>
              The MDRRMO sees this on the website and sends help.
            </Text>

            <View style={{ gap: 8, marginVertical: 12 }}>
              {Object.entries(BACKUP_NEEDS).map(([need, info]) => {
                const asked = selectedResident?.backups?.some((b) => b.need === need);
                return (
                  <TouchableOpacity
                    key={need}
                    style={[styles.optBtn, asked && styles.optBtnActive]}
                    disabled={asked || busy}
                    onPress={() => handleSendSupportRequest(need)}
                  >
                    <Text style={styles.optTitle}>{info.icon} {info.label}{asked ? ' (already asked)' : ''}</Text>
                    <Text style={styles.optDesc}>{info.desc}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity style={styles.btnCancel} onPress={() => setSupportModalVisible(false)}>
              <Text style={{ fontWeight: '800', color: '#64748B' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* GPS Settings Modal */}
      <Modal visible={gpsModalVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.dialog}>
            <Text style={[styles.dialogTitle, { color: '#0284C7' }]}>📍 YOUR LOCATION</Text>
            <Text style={styles.checkInSub}>
              Use the phone's GPS, or a demo location for testing:
            </Text>

            <View style={{ gap: 8, marginVertical: 12 }}>
              <TouchableOpacity
                style={[styles.optBtn, gpsMode === 'REAL' && styles.optBtnReal]}
                onPress={() => {
                  setGpsMode('REAL');
                  setIsLocatingGps(true);
                  setGpsModalVisible(false);
                  setTriggerGpsQuery(Date.now());
                }}
              >
                <Text style={{ fontWeight: '900', fontSize: 12.5, color: '#0F172A' }}>
                  🛰️ Use phone GPS
                </Text>
                <Text style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                  Your real location.
                </Text>
              </TouchableOpacity>

              {/* Simulated positions are for development builds only. */}
              {__DEV__ && (<>
              <TouchableOpacity
                style={[styles.optBtn, gpsMode === 'SIMULATED' && styles.optBtnActive]}
                onPress={() => {
                  setGpsMode('SIMULATED');
                  setGpsModalVisible(false);
                  setIsSettingSimGps(true);
                }}
              >
                <Text style={{ fontWeight: '900', fontSize: 12.5, color: '#0284C7' }}>
                  👆 Demo: tap the map to set location
                </Text>
                <Text style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                  For testing only. Not your real location.
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.optBtn}
                onPress={() => {
                  setGpsMode('SIMULATED');
                  placeUnit({ lat: 10.2536, lng: 123.9512 });
                  setGpsModalVisible(false);
                  setTriggerGpsQuery(Date.now());
                }}
              >
                <Text style={{ fontWeight: '800', fontSize: 12, color: '#1E293B' }}>
                  🕹️ Demo: Poblacion command post
                </Text>
              </TouchableOpacity>
              </>)}
            </View>

            <TouchableOpacity style={styles.btnCancel} onPress={() => setGpsModalVisible(false)}>
              <Text style={{ fontWeight: '800', color: '#64748B' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Shelter Gate Check-In Modal */}
      <Modal visible={checkInModalVisible} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.dialog}>
            <Text style={[styles.dialogTitle, { color: '#1E3A8A' }]}>🏥 CHECK IN AT CENTER</Text>
            <Text style={styles.checkInSub}>Center the household was brought to:</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {feed.centers.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.optBtn, { paddingVertical: 6 }, checkInCenterId === c.id && styles.memberChecked]}
                  onPress={() => setCheckInCenterId(c.id)}
                >
                  <Text style={{ fontWeight: '800', fontSize: 11.5, color: checkInCenterId === c.id ? '#15803D' : '#0F172A' }}>
                    🏥 {c.name} ({c.occupied}/{c.capacity})
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {(selectedResident?.members || []).length > 0 && (
              <Text style={[styles.checkInSub, { marginTop: 8 }]}>Tap anyone who was not brought in:</Text>
            )}
            <View style={{ gap: 6, marginVertical: 10 }}>
              {(selectedResident?.members || []).map((m) => {
                const isChecked = checkedMemberIds.includes(m.id);
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.optBtn, isChecked && styles.memberChecked]}
                    onPress={() => toggleMemberCheck(m.id)}
                  >
                    <Text style={{ fontWeight: '800', fontSize: 12.5, color: isChecked ? '#15803D' : '#B91C1C' }}>
                      {isChecked ? '☑️ CHECKED IN: ' : '⚠️ NOT WITH US: '} {m.name} ({m.role})
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <TouchableOpacity style={styles.btnCancel} onPress={() => setCheckInModalVisible(false)}>
                <Text style={{ fontWeight: '700', color: '#64748B' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnSubmit, { backgroundColor: '#16A34A' }]} onPress={handleConfirmShelterCheckIn} disabled={busy}>
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: '#FFF', fontWeight: '800' }}>Confirm Check-In</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Hazard Submission Modal */}
      <Modal visible={Boolean(pendingCoords)} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>REPORT A HAZARD</Text>
            <View style={{ gap: 6, marginVertical: 10 }}>
              {HAZARD_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.optBtn, selectedHazard.id === opt.id && styles.optBtnActive]}
                  onPress={() => setSelectedHazard(opt)}
                >
                  <Text>{opt.icon} {opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={styles.input} placeholder="Short description..." value={hazardNote} onChangeText={setHazardNote} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={styles.btnCancel} onPress={() => setPendingCoords(null)}><Text>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.btnSubmit} onPress={handleBroadcastHazard} disabled={busy}>
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: '#FFF', fontWeight: '800' }}>Send</Text>}
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
  container: { flex: 1, backgroundColor: COLORS.background },

  floatingTopBar: { position: 'absolute', left: 14, zIndex: 10 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 4,
  },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusText: { fontSize: 10, fontWeight: '800', color: COLORS.textDark },

  focusBanner: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1E3A8A',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    elevation: 5,
  },
  focusBannerText: { color: '#FFF', fontSize: 10.5, fontWeight: '900', flex: 1 },
  btnResetFocus: { backgroundColor: '#3B82F6', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 4 },
  btnResetFocusText: { color: '#FFF', fontSize: 10, fontWeight: '900' },

  dropBanner: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 10,
    backgroundColor: '#DC2626',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    elevation: 6,
  },
  dropBannerText: { color: '#FFF', fontSize: 11, fontWeight: '800', flex: 1, paddingRight: 8 },
  dropCancelText: { color: '#FEE2E2', fontSize: 11, fontWeight: '800' },

  floatingFilter: {
    position: 'absolute',
    left: 14,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 24,
    elevation: 6,
    borderWidth: 1,
  },
  filterActiveSos: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  filterAll: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' },
  floatingFilterText: { fontSize: 11, fontWeight: '900' },
  filterTextSos: { color: '#DC2626' },
  filterTextAll: { color: '#1E3A8A' },

  gpsPill: {
    position: 'absolute', left: 14, right: 14, zIndex: 9, backgroundColor: '#FFFFFF',
    borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, elevation: 5,
  },
  fabStack: { position: 'absolute', right: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  circleFab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  fabGpsReal: { borderColor: '#16A34A', backgroundColor: '#F0FDF4' },
  fabGpsSim: { borderColor: '#0284C7', backgroundColor: '#F0F9FF' },
  circleFabIcon: { fontSize: 18 },

  hazardFab: { backgroundColor: '#DC2626', paddingVertical: 11, paddingHorizontal: 15, borderRadius: 24, elevation: 6 },
  hazardFabText: { color: '#FFF', fontSize: 11, fontWeight: '900' },

  actionSheet: {
    position: 'absolute',
    left: 14,
    right: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 5,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  sheetName: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
  },
  badgeCritical: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  badgeCriticalText: {
    color: '#DC2626',
    fontSize: 9,
    fontWeight: '900',
  },
  badgeNormal: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  badgeNormalText: {
    color: '#475569',
    fontSize: 9,
    fontWeight: '800',
  },
  timeTag: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0284C7',
  },

  incidentBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginVertical: 4,
  },
  distinctEmergencyBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 5,
    borderWidth: 1,
  },
  distinctEmergencyText: {
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  locationMetaCol: {
    flex: 1,
    justifyContent: 'center',
  },
  addressText: {
    fontSize: 11,
    color: '#0F172A',
    fontWeight: '700',
  },
  displacedNoticeText: {
    fontSize: 10,
    color: '#B45309',
    fontWeight: '800',
    marginTop: 1,
  },
  atHomeNoticeText: {
    fontSize: 10,
    color: '#15803D',
    fontWeight: '700',
    marginTop: 1,
  },

  btnDossierPill: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  btnDossierPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1E3A8A',
  },
  closeBtn: {
    fontSize: 15,
    color: '#94A3B8',
    fontWeight: 'bold',
    paddingHorizontal: 4,
  },

  tacticalInfoBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 9,
    paddingVertical: 7,
    marginTop: 3,
  },
  tacticalNoteText: { fontSize: 12.5, color: '#334155', marginBottom: 3 },
  tacticalGearText: {
    fontSize: 11,
    color: '#475569',
    lineHeight: 15,
  },
  tacticalLandmarkText: {
    fontSize: 10.5,
    color: '#D97706',
    fontWeight: '700',
    marginTop: 2,
    lineHeight: 14,
  },
  btnMiniBackup: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#93C5FD',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
  },
  btnMiniBackupText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1D4ED8',
  },

  supportBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
    borderColor: '#93C5FD',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginTop: 6,
  },
  supportBannerType: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#1E3A8A',
  },
  btnSupportChangeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#2563EB',
  },
  btnSupportCancelText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#DC2626',
    marginLeft: 6,
  },

  btnStatus: {
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnStatusText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  btnPreEmptive: {
    backgroundColor: '#1E3A8A',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnPreEmptiveText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  btnFalseReport: {
    paddingVertical: 8,
    borderRadius: 7,
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  btnFalseReportText: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '800',
  },
  btnUndo: {
    paddingVertical: 4,
    alignItems: 'center',
    marginTop: 2,
  },
  btnUndoText: {
    color: '#94A3B8',
    fontSize: 9.5,
    fontWeight: '700',
  },
  evacuatedBanner: {
    backgroundColor: '#F0FDF4',
    padding: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  evacuatedText: {
    color: '#15803D',
    fontSize: 11,
    fontWeight: '900',
  },

  verifBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, borderWidth: 1 },
  verifBadgeConfirmed: { backgroundColor: '#DCFCE7', borderColor: '#16A34A' },
  verifTextConfirmed: { color: '#15803D', fontSize: 9, fontWeight: '900' },
  verifBadgeUnverified: { backgroundColor: '#FFFBEB', borderColor: '#D97706' },
  verifTextUnverified: { color: '#B45309', fontSize: 9, fontWeight: '900' },
  hazardDescriptionText: { fontSize: 11.5, color: '#0F172A', fontWeight: '700', marginTop: 3 },
  callReporterText: { fontSize: 12, color: '#1D4ED8', fontWeight: '800', marginTop: 6 },
  badgeUnverified: { backgroundColor: '#FEF3C7', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 6 },
  badgeUnverifiedText: { fontSize: 9.5, fontWeight: '800', color: '#B45309' },
  reportedByText: { fontSize: 9.5, color: '#64748B', marginTop: 2 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 18 },
  dialog: { backgroundColor: '#FFF', borderRadius: 14, padding: 16 },
  dialogTitle: { fontSize: 14, fontWeight: '900', color: '#DC2626' },
  checkInSub: { fontSize: 11, color: '#475569', marginTop: 4, lineHeight: 15 },
  optBtn: { padding: 9, borderRadius: 8, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1' },
  optBtnActive: { backgroundColor: '#EFF6FF', borderColor: '#3B82F6' },
  optBtnReal: { backgroundColor: '#F0FDF4', borderColor: '#86EFAC' },
  memberChecked: { backgroundColor: '#F0FDF4', borderColor: '#86EFAC' },
  optTitle: { fontSize: 11.5, fontWeight: '800', color: '#0F172A' },
  optDesc: { fontSize: 10, color: '#64748B', marginTop: 1 },
  input: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, padding: 9, fontSize: 12, marginBottom: 10 },
  btnCancel: { backgroundColor: '#F1F5F9', padding: 11, borderRadius: 7, alignItems: 'center' },
  btnSubmit: { flex: 2, backgroundColor: '#DC2626', padding: 11, borderRadius: 7, alignItems: 'center' },

  dossierBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.85)', justifyContent: 'flex-end' },
  dossierCard: { backgroundColor: '#FFF', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16 },
  dossierHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderBottomWidth: 1, borderColor: '#E2E8F0', paddingBottom: 10 },
  dossierSuperTitle: { fontSize: 9.5, fontWeight: '900', color: '#1E3A8A', letterSpacing: 0.5 },
  dossierName: { fontSize: 17, fontWeight: '900', color: '#0F172A', marginTop: 1 },
  dossierSubLocation: { fontSize: 11, color: '#64748B', fontWeight: '600' },
  dossierCloseBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  dossierCloseBtnText: { fontSize: 14, fontWeight: '900', color: '#475569' },
  dossierScroll: { paddingVertical: 12 },

  facadeSection: { borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#CBD5E1', marginBottom: 12 },
  facadeLargeImg: { width: '100%', height: 160 },
  landmarkBanner: { backgroundColor: '#FFFBEB', padding: 8, borderTopWidth: 1, borderColor: '#FDE68A' },
  landmarkBannerTitle: { fontSize: 9.5, fontWeight: '900', color: '#B45309' },
  landmarkBannerText: { fontSize: 11.5, color: '#78350F', fontWeight: '700', marginTop: 2 },

  dossierSecHeader: { fontSize: 10, fontWeight: '900', color: '#475569', letterSpacing: 0.3, marginBottom: 6 },
  tallyGrid: { flexDirection: 'row', gap: 6 },
  tallyBox: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  tallyNum: { fontSize: 16, fontWeight: '900' },
  tallyLabel: { fontSize: 8.5, fontWeight: '800', color: '#475569', marginTop: 1, textAlign: 'center' },
  pregnantAlertBadge: { backgroundColor: '#FDF2F8', borderWidth: 1, borderColor: '#FBCFE8', borderRadius: 6, padding: 6, marginTop: 6 },
  pregnantAlertText: { fontSize: 10, fontWeight: '800', color: '#BE185D', textAlign: 'center' },

  infoRowCard: { flexDirection: 'row', backgroundColor: '#F8FAFC', borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', padding: 10, alignItems: 'center' },
  infoItem: { flex: 1, alignItems: 'center' },
  infoDivider: { width: 1, height: 24, backgroundColor: '#CBD5E1' },
  infoItemLabel: { fontSize: 8.5, fontWeight: '800', color: '#64748B' },
  infoItemValue: { fontSize: 10.5, fontWeight: '900', color: '#0F172A', marginTop: 2, textAlign: 'center' },

  contactRowCard: { backgroundColor: '#EFF6FF', borderRadius: 8, borderWidth: 1, borderColor: '#BFDBFE', padding: 10 },
  contactNumberText: { fontSize: 12, fontWeight: '900', color: '#1E3A8A' },
  contactNumberSub: { fontSize: 11, fontWeight: '700', color: '#1E40AF', marginTop: 2 },

  memberDossierRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', padding: 8, borderRadius: 6 },
  memberDossierName: { fontSize: 12, fontWeight: '800', color: '#0F172A' },
  memberDossierRole: { fontSize: 10, color: '#64748B', marginTop: 1 },
  memberDossierBadge: { paddingHorizontal: 6, paddingVertical: 2.5, borderRadius: 4, borderWidth: 1 },
  dossierBgNeutral: { backgroundColor: '#F1F5F9', borderColor: '#CBD5E1' },
  dossierBgMissing: { backgroundColor: '#FEE2E2', borderColor: '#FECACA' },
  dossierBgAdmitted: { backgroundColor: '#DCFCE7', borderColor: '#86EFAC' },
  memberDossierBadgeText: { fontSize: 9, fontWeight: '900', color: '#475569' },

  btnCloseDossierModal: { backgroundColor: '#1E3A8A', paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginTop: 6 },
  btnCloseDossierModalText: { color: '#FFF', fontSize: 12, fontWeight: '900' },
});