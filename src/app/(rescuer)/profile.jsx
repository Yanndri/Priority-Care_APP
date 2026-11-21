import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import BottomNav from '../../components/BottomNav';
import ChangePasscode from '../../components/ChangePasscode';
import { useSession } from '../../components/SessionProvider';
import { signOut } from '../../services/api';
import { useRescuerFeed } from '../../lib/rescuerFeed';
import { downloadCordovaMap, getOfflineMapInfo, removeOfflineMap } from '../../services/tileDownloader';

export default function RescuerProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useSession();
  const feed = useRescuerFeed();
  const units = feed.me?.units || [];
  const myName = [profile?.f_name, profile?.l_name].filter(Boolean).join(' ');
  const unitNames = units.map((u) => u.unit_name).join(', ');
  const capabilities = [...new Set(units.flatMap((u) => u.capabilities || []))];

  // Offline map of Cordova: one download, used by the map when there is no signal.
  const [mapInfo, setMapInfo] = useState(null);
  const [progress, setProgress] = useState(null); // 'done/total' while downloading
  useEffect(() => { getOfflineMapInfo().then(setMapInfo); }, []);
  const handleDownloadMap = async () => {
    setProgress('0');
    try {
      const info = await downloadCordovaMap((done, total) => setProgress(`${done}/${total}`));
      setMapInfo(info);
      Alert.alert('Map saved 📦', info.tiles < info.total
        ? `${info.tiles} of ${info.total} map pieces saved. Tap Update with a better signal to get the rest.`
        : 'The map of Cordova is saved on this phone and works without signal.');
    } catch (e) {
      Alert.alert('Not saved', 'Could not save the map. Check your connection and try again.');
    } finally {
      setProgress(null);
    }
  };
  const handleRemoveMap = () => Alert.alert('Remove the offline map?', 'Frees about 10 MB. The map still works with signal.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => { await removeOfflineMap(); setMapInfo(null); } },
  ]);

  const handleSignOut = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  // Status is worked out from the tickets, not set by hand: busy while your unit has a live SOS.
  // "Off duty" is the admin switching the unit off on the web (Units tab).
  const myTickets = feed.incidents.filter((i) => i.isMine);
  const status = !units.length
    ? { label: '⚫ Not in a unit', sub: 'Ask your admin to add you to a responder unit.', color: '#64748B' }
    : myTickets.length
      ? { label: '🟡 Busy', sub: `On ${myTickets.map((t) => `SOS #${t.ticketNo}`).join(', ')}`, color: '#D97706' }
      : { label: '🟢 Available', sub: 'No SOS assigned to your unit right now.', color: '#16A34A' };
  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Text style={styles.sub}>MY RESPONDER PROFILE</Text>
        <Text style={styles.title}>{unitNames || 'No unit assigned'}</Text>
      </View>

      <View style={{ padding: 16, gap: 12, flex: 1 }}>
        {/* Status, worked out from the unit's tickets */}
        <View style={styles.card}>
          <Text style={styles.label}>MY STATUS</Text>
          <Text style={[styles.statusNow, { color: status.color }]}>{status.label}</Text>
          <Text style={styles.statusSub}>{status.sub}</Text>
        </View>

        {/* Name and unit skills */}
        <View style={styles.card}>
          <Text style={styles.label}>NAME & SKILLS</Text>
          <Text style={styles.val}>{myName || 'Responder'} • MDRRMO Cordova</Text>
          <Text style={styles.subVal}>
            {capabilities.length ? capabilities.join(' • ') : 'Ask your administrator to add you to a response unit.'}
          </Text>
        </View>

        {/* Offline map */}
        <View style={styles.card}>
          <Text style={styles.label}>OFFLINE MAP</Text>
          <View style={styles.toolRow}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.val}>{mapInfo ? 'Cordova map saved' : 'Not saved yet'}</Text>
              <Text style={styles.subVal}>
                {progress ? `Saving… ${progress}` : mapInfo
                  ? `Saved ${new Date(mapInfo.savedAt).toLocaleDateString()} • works without signal`
                  : 'Save it before a disaster (about 10 MB) so the map works without signal.'}
              </Text>
            </View>
            <TouchableOpacity style={styles.btnActionSmall} onPress={handleDownloadMap} disabled={Boolean(progress)}>
              <Text style={styles.btnActionSmallText}>{progress ? '…' : mapInfo ? 'Update' : 'Download'}</Text>
            </TouchableOpacity>
          </View>
          {mapInfo && !progress && (
            <TouchableOpacity onPress={handleRemoveMap} style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 11, color: '#DC2626', fontWeight: '800' }}>Remove offline map</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ marginTop: 'auto' }}><ChangePasscode isResident={false} /></View>
        <TouchableOpacity style={[styles.logoutBtn, { marginTop: 0 }]} onPress={handleSignOut}>
          <Text style={styles.logoutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
      <BottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { paddingHorizontal: 16, paddingBottom: 10, backgroundColor: '#FFF', borderBottomWidth: 1, borderColor: '#E2E8F0' },
  sub: { fontSize: 9.5, fontWeight: '800', color: '#64748B' },
  title: { fontSize: 18, fontWeight: '900', color: '#0F172A' },
  card: { backgroundColor: '#FFF', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0' },
  label: { fontSize: 9.5, fontWeight: '800', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 8 },
  val: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  subVal: { fontSize: 11, color: '#64748B', marginTop: 2, fontWeight: '600' },
  statusNow: { fontSize: 16, fontWeight: '900', marginTop: 4 },
  statusSub: { fontSize: 12, color: '#64748B', marginTop: 2 },
  toolRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  btnActionSmall: { backgroundColor: '#1E3A8A', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 6 },
  btnActionSmallText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  logoutBtn: { backgroundColor: '#DC2626', paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginTop: 'auto' },
  logoutText: { color: '#FFF', fontSize: 13, fontWeight: '800' },
});