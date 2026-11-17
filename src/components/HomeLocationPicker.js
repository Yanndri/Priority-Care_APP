// "Use My Current Location": reads the phone's GPS, pins it on the map and lets
// the resident tap the map to move the pin when the reading is off. Used by
// registration and the resident profile. Reuses the app's OfflineMap.
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import OfflineMap from './offlineMap';
import { getLocationFix } from '../lib/location';

const POOR_ACCURACY_M = 30;

const ERRORS = {
  denied: 'Location permission is off. Allow location for PriorityCare in your phone settings, or tap the map on your house to place the pin.',
  services_off: 'Your phone\'s location (GPS) is switched off. Turn it on and tap Try GPS again, or tap the map on your house.',
  no_fix: 'Could not get a GPS reading. Go outdoors or near a window and tap Try GPS again, or tap the map on your house.',
};

// fallback: { lat, lng } where the map starts when there is no GPS (saved home or barangay centre).
export default function HomeLocationPicker({ visible, fallback = null, saving = false, onCancel, onConfirm }) {
  const insets = useSafeAreaInsets();
  const [pin, setPin] = useState(null);
  const [fix, setFix] = useState(null);       // last GPS reading { lat, lng, accuracy, fromCache }
  const [error, setError] = useState(null);   // { code, canAskAgain }
  const [locating, setLocating] = useState(false);
  const [adjusted, setAdjusted] = useState(false);
  const [flyTs, setFlyTs] = useState(0);

  const locate = useCallback(async () => {
    setLocating(true);
    setError(null);
    const r = await getLocationFix();
    setLocating(false);
    if (r.error) {
      setError({ code: r.error, canAskAgain: r.canAskAgain });
      setFlyTs(Date.now()); // show the fallback pin (saved home or barangay centre)
      return;
    }
    setFix(r);
    setPin({ lat: r.lat, lng: r.lng });
    setAdjusted(false);
    setFlyTs(Date.now());
  }, []);

  // Start locating as soon as the picker opens.
  useEffect(() => {
    if (!visible) return;
    setFix(null);
    setError(null);
    setAdjusted(false);
    setPin(fallback ? { lat: fallback.lat, lng: fallback.lng } : null);
    setFlyTs(Date.now());
    locate();
  }, [visible]);

  const poor = fix && !adjusted && (fix.accuracy == null || fix.accuracy > POOR_ACCURACY_M);

  let status;
  if (locating) status = { text: 'Finding your location…', color: '#1E3A8A' };
  else if (adjusted) status = { text: 'Pin moved by you. Tap again to fine-tune.', color: '#15803D' };
  else if (error) status = { text: ERRORS[error.code], color: '#B91C1C' };
  else if (fix) {
    status = poor
      ? { text: `GPS accuracy is poor (±${fix.accuracy ?? '?'} m). Tap the map on your house to correct the pin.`, color: '#B45309' }
      : { text: `Location found (±${fix.accuracy} m). Tap the map if the pin is not on your house.`, color: '#15803D' };
    if (fix.fromCache) status.text += ' This is your last known position.';
  } else status = { text: 'Tap the map on your house to place the pin.', color: '#475569' };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.title}>📍 Pin your home</Text>
          <TouchableOpacity onPress={onCancel} disabled={saving}><Text style={styles.close}>Cancel</Text></TouchableOpacity>
        </View>

        <OfflineMap
          role="resident"
          residents={[]}
          userGpsCoords={pin}
          gpsMode="SIMULATED"
          isSettingSimGps
          triggerGpsQuery={flyTs}
          pinLabel="Your home pin"
          onSimGpsCoordinateDrop={(c) => { setPin({ lat: c.lat, lng: c.lng }); setAdjusted(true); }}
        />

        <View style={[styles.panel, { paddingBottom: 12 + insets.bottom }]}>
          <Text style={[styles.status, { color: status.color }]}>{status.text}</Text>
          {pin && <Text style={styles.coords}>{pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}</Text>}
          <View style={styles.row}>
            {error?.code === 'denied' && !error.canAskAgain ? (
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => Linking.openSettings()}>
                <Text style={styles.btnGhostText}>Open settings</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={locate} disabled={locating || saving}>
                <Text style={styles.btnGhostText}>{locating ? 'Locating…' : '🛰️ Try GPS again'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, (!pin || locating) && { opacity: 0.5 }]}
              disabled={!pin || locating || saving}
              onPress={() => onConfirm({ lat: pin.lat, lng: pin.lng, accuracy: adjusted ? null : fix?.accuracy ?? null, adjusted })}
            >
              {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnPrimaryText}>Save this location</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 16, fontWeight: '900', color: '#0F172A' },
  close: { fontSize: 14, fontWeight: '800', color: '#64748B' },
  panel: { padding: 14, gap: 8, borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  status: { fontSize: 13, fontWeight: '700' },
  coords: { fontSize: 11, color: '#64748B' },
  row: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { borderWidth: 1, borderColor: '#CBD5E1' },
  btnGhostText: { fontWeight: '800', color: '#1E293B' },
  btnPrimary: { backgroundColor: '#1E3A8A' },
  btnPrimaryText: { color: '#FFFFFF', fontWeight: '900' },
});
