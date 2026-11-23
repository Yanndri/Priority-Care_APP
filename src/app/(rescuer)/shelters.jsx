import React, { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Modal, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomNav from '../../components/BottomNav';
import { FONT_SIZES, FONT_WEIGHTS } from '../../constants/typography';
import { useRescuerFeed } from '../../lib/rescuerFeed';
import { shelterLoad, getCurrentCoords, distanceMeters, formatDistance } from '../../lib/location';
import { centerTypeLabel } from '../../lib/mapData';
import { admitWalkIn } from '../../services/api';

const LOAD_STYLE = {
  OPEN: { statusBg: '#DCFCE7', statusColor: '#15803D' },
  'NEAR CAPACITY': { statusBg: '#FEF3C7', statusColor: '#B45309' },
  FULL: { statusBg: '#FEE2E2', statusColor: '#B91C1C' },
};

export default function RescuerSheltersScreen() {
  const insets = useSafeAreaInsets();
  const feed = useRescuerFeed();
  const router = useRouter();
  // Where the responder is, only to sort centers by distance (asked once, not tracked).
  const [here, setHere] = useState(null);
  useEffect(() => { getCurrentCoords().then((p) => { if (p) setHere(p); }); }, []);
  const shelterList = feed.centers.map((c) => {
    const load = shelterLoad(c);
    const meters = distanceMeters(here, c);
    return {
      ...c,
      meters,
      percent: load.percent,
      status: load.label,
      barColor: load.color,
      ...LOAD_STYLE[load.label],
      tag: [centerTypeLabel(c.raw?.center_type), ...(c.raw?.amenities || [])].filter(Boolean).join(' • '),
    };
  }).sort((a, b) => (a.meters ?? Infinity) - (b.meters ?? Infinity) || a.name.localeCompare(b.name));

  // Opens the center on the Map tab (same focus the disaster banner uses).
  const openOnMap = (c) => {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return;
    router.push({ pathname: '/(rescuer)/map', params: {
      focusDisasterTs: String(Date.now()), focusDisasterLat: String(c.lat), focusDisasterLng: String(c.lng),
      focusDisasterLabel: c.name, focusDisasterIcon: '🏥',
      focusDisasterNote: `${Math.max(0, c.capacity - c.occupied)} spaces left`,
    } });
  };
  const [showAllCenters, setShowAllCenters] = useState(false);
  const barangays = Object.entries(feed.barangayNames).map(([id, name]) => ({ id: Number(id), name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const [intakeModalVisible, setIntakeModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  // Walk-in check-in: one row per person, so a missing report can find each of them by name.
  const OUTSIDE = 'outside';
  const [people, setPeople] = useState(['']);
  const [walkinBarangayId, setWalkinBarangayId] = useState(null); // a barangay id, OUTSIDE, or null (not chosen)
  const [walkinSitio, setWalkinSitio] = useState('');
  const [walkinNeeds, setWalkinNeeds] = useState('');
  const [targetShelterId, setTargetShelterId] = useState(null);
  const targetShelter = shelterList.find((s) => s.id === targetShelterId) || shelterList.find((s) => s.capacity - s.occupied > 0) || shelterList[0];
  const names = people.map((n) => n.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const free = targetShelter ? Math.max(0, targetShelter.capacity - targetShelter.occupied) : 0;
  const tooMany = names.length > free;

  const setPerson = (index, value) => setPeople((list) => list.map((n, k) => (k === index ? value : n)));
  const removePerson = (index) => setPeople((list) => (list.length > 1 ? list.filter((_, k) => k !== index) : ['']));

  const resetWalkin = () => {
    setPeople(['']);
    setWalkinBarangayId(null);
    setWalkinSitio('');
    setWalkinNeeds('');
  };

  const handleWalkinAdmission = async () => {
    if (!targetShelter) return Alert.alert('No center open', 'There is no open evacuation center to check them in to.');
    if (!names.length) return Alert.alert('Who came?', 'Type the name of at least one person.');
    if (walkinBarangayId === null) return Alert.alert('Where are they from?', 'Choose their barangay, or "Outside Cordova / not sure".');
    if (tooMany) return Alert.alert('Not enough space', `${targetShelter.name} has ${free} space${free === 1 ? '' : 's'} left. Choose another center.`);
    setSaving(true);
    const failed = [];
    let firstError = '';
    for (let k = 0; k < names.length; k += 1) {
      try {
        await admitWalkIn({
          centerId: targetShelter.id, name: names[k],
          barangayId: walkinBarangayId === OUTSIDE ? null : walkinBarangayId,
          sitio: walkinSitio.trim(), headcount: 1,
          // The note is saved once, with the first person, so needs are not counted twice.
          needs: k === 0 ? walkinNeeds.trim() : '',
        });
      } catch (e) {
        failed.push(names[k]);
        if (!firstError) firstError = e.message;
      }
    }
    await feed.reload();
    setSaving(false);
    const done = names.length - failed.length;
    if (failed.length) {
      setPeople(failed); // keep only the ones that still need checking in
      return Alert.alert(done ? 'Some were not checked in' : 'Not checked in',
        `${done ? `${done} checked in. ` : ''}Not checked in: ${failed.join(', ')}.\n${firstError}`);
    }
    setIntakeModalVisible(false);
    resetWalkin();
    Alert.alert('Checked in', `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} checked in at ${targetShelter.name}.`);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sub}>EVACUATION CENTERS</Text>
          <Text style={styles.title}>Centers & evacuees</Text>
        </View>
        <TouchableOpacity style={styles.btnWalkin} onPress={() => setIntakeModalVisible(true)}>
          <Text style={styles.btnWalkinText}>➕ Add walk-in</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={shelterList}
        keyExtractor={(item) => String(item.id)}
        refreshing={feed.loading}
        onRefresh={feed.reload}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: '#64748B', marginTop: 16 }}>
            {feed.error ? `Could not load shelters: ${feed.error}` : 'No evacuation center is open right now.'}
          </Text>
        }
        contentContainerStyle={{ padding: 14, gap: 12 }}
        ListHeaderComponent={
          <View style={{ gap: 8, marginBottom: 4 }}>
            <Text style={styles.secTitle}>OPEN CENTERS IN CORDOVA{here ? ' · NEAREST FIRST' : ''}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.shelterCard} activeOpacity={0.8} onPress={() => openOnMap(item)}
            accessibilityRole="button" accessibilityLabel={`${item.name}, open on the map`}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.shelterName}>{item.name}</Text>
                <Text style={styles.shelterTag}>{item.tag}</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: item.statusBg, borderColor: item.barColor }]}>
                <Text style={[styles.badgeText, { color: item.statusColor }]}>{item.status}</Text>
              </View>
            </View>

            {/* Occupancy Progress Bar */}
            <View style={styles.occupancyRow}>
              <Text style={styles.occupancyText}>
                {item.occupied} / {item.capacity} Beds Occupied ({item.percent}%)
              </Text>
              <Text style={styles.slotsLeftText}>{Math.max(0, item.capacity - item.occupied)} spaces left</Text>
            </View>
            <View style={styles.barBg}>
              <View style={{ height: '100%', width: `${item.percent}%`, backgroundColor: item.barColor }} />
            </View>
            <Text style={styles.tapMap}>{item.meters != null ? `${formatDistance(item.meters)} away · ` : ''}Tap to see it on the map ›</Text>
          </TouchableOpacity>
        )}
      />

      {/* Walk-in check-in form */}
      <Modal visible={intakeModalVisible} transparent animationType="slide" onRequestClose={() => setIntakeModalVisible(false)}>
        <View style={styles.modalBg}>
          {/* Title and buttons stay put; only the fields scroll, so Cancel / Check in are never cut off. */}
          <View style={styles.dialog}>
            <View style={styles.dialogHead}>
              <Text style={styles.dialogTitle}>Add walk-in</Text>
              <TouchableOpacity onPress={() => setIntakeModalVisible(false)} accessibilityLabel="Close" hitSlop={10}>
                <Text style={styles.closeX}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.dialogSub}>
              People who came to a center on their own. Add each person by name, so their family can find them.
            </Text>

            <Text style={styles.fieldLabel}>1. Which center?</Text>
            <View style={{ gap: 6, marginBottom: 14 }}>
              {(showAllCenters ? shelterList : shelterList.filter((s) => s.capacity - s.occupied > 0 || s.id === targetShelter?.id).slice(0, 3)).map((s) => {
                const left = Math.max(0, s.capacity - s.occupied);
                const on = targetShelter?.id === s.id;
                return (
                  <TouchableOpacity key={s.id} style={[styles.shelterOpt, on && styles.shelterOptActive, !left && styles.optFull]}
                    onPress={() => setTargetShelterId(s.id)} disabled={!left}>
                    <Text style={[styles.shelterOptText, on && styles.shelterOptTextActive]}>
                      {on ? '● ' : '○ '}{s.name} · {left ? `${left} space${left === 1 ? '' : 's'} left` : 'Full'}{s.meters != null ? ` · ${formatDistance(s.meters)}` : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {shelterList.length > 3 && (
                <TouchableOpacity onPress={() => setShowAllCenters((v) => !v)} style={{ paddingVertical: 6 }}>
                  <Text style={styles.addPersonText}>{showAllCenters ? 'Show the 3 nearest only' : `Show all ${shelterList.length} centers`}</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.fieldLabel}>2. Who came? One name per person</Text>
            <Text style={styles.hint}>Write first and last name. A child with no known first name can be "Baby Santos".</Text>
            {people.map((n, k) => (
              <View key={k} style={styles.personRow}>
                <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder={`Person ${k + 1}: full name`}
                  value={n} onChangeText={(v) => setPerson(k, v)} autoCapitalize="words" maxLength={200} />
                {people.length > 1 && (
                  <TouchableOpacity style={styles.removeBtn} onPress={() => removePerson(k)} accessibilityLabel={`Remove person ${k + 1}`}>
                    <Text style={styles.removeText}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
            <TouchableOpacity style={styles.addPerson} onPress={() => setPeople((list) => [...list, ''])} disabled={people.length >= 30}>
              <Text style={styles.addPersonText}>+ Add another person</Text>
            </TouchableOpacity>

            <Text style={styles.fieldLabel}>3. Where are they from?</Text>
            <View style={styles.chipWrap}>
              {[...barangays, { id: OUTSIDE, name: 'Outside Cordova / not sure' }].map((b) => (
                <TouchableOpacity key={b.id} style={[styles.chip, walkinBarangayId === b.id && styles.chipOn]} onPress={() => setWalkinBarangayId(b.id)}>
                  <Text style={[styles.chipText, walkinBarangayId === b.id && styles.chipTextOn]}>{b.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={styles.input} placeholder="Sitio or landmark (optional)" value={walkinSitio} onChangeText={setWalkinSitio} maxLength={100} />

            <Text style={styles.fieldLabel}>4. Anything the center should know? (optional)</Text>
            <TextInput style={styles.input} placeholder="e.g. a senior, uses a wheelchair, an infant" value={walkinNeeds} onChangeText={setWalkinNeeds} maxLength={500} />

            {tooMany && targetShelter && (
              <Text style={styles.warn}>{targetShelter.name} has only {free} space{free === 1 ? '' : 's'} left. Choose another center.</Text>
            )}
            </ScrollView>
            <View style={styles.dialogFoot}>
              <TouchableOpacity style={styles.btnCancel} onPress={() => setIntakeModalVisible(false)} disabled={saving}>
                <Text style={styles.btnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnSubmit, (saving || !names.length || tooMany) && { opacity: 0.6 }]}
                onPress={handleWalkinAdmission} disabled={saving || !names.length || tooMany}>
                {saving ? <ActivityIndicator color="#FFF" />
                  : <Text style={styles.btnSubmitText}>{names.length > 1 ? `Check in ${names.length} people` : 'Check in'}</Text>}
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, backgroundColor: '#FFF', borderBottomWidth: 1, borderColor: '#E2E8F0' },
  sub: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#64748B' },
  title: { fontSize: FONT_SIZES.title, fontWeight: FONT_WEIGHTS.black, color: '#0F172A' },
  btnWalkin: { backgroundColor: '#15803D', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 6 },
  btnWalkinText: { color: '#FFF', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold },

  secTitle: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#64748B' },

  shelterCard: { backgroundColor: '#FFF', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', elevation: 1 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  shelterName: { fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.extraBold, color: '#1E3A8A' },
  shelterTag: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.bold, color: '#64748B', marginTop: 2 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  badgeText: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold },

  occupancyRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  occupancyText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#0F172A' },
  slotsLeftText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#15803D' },
  barBg: { height: 8, backgroundColor: '#E2E8F0', borderRadius: 4, overflow: 'hidden', marginVertical: 6 },
  tapMap: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#1D4ED8', marginTop: 2 },
  catchmentText: { fontSize: FONT_SIZES.caption, color: '#475569', marginTop: 4 },


  modalBg: { flex: 1, backgroundColor: 'rgba(15,23,42,0.7)', justifyContent: 'center', padding: 18 },
  dialog: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, maxHeight: '88%' },
  dialogFoot: { flexDirection: 'row', gap: 8, paddingTop: 10, borderTopWidth: 1, borderColor: '#E2E8F0' },
  dialogHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  closeX: { fontSize: 20, color: '#64748B', paddingHorizontal: 4 },
  dialogTitle: { fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.black, color: '#1E3A8A' },
  hint: { fontSize: FONT_SIZES.tiny, color: '#64748B', marginBottom: 6 },
  personRow: { flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 6 },
  removeBtn: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F5F9' },
  removeText: { fontSize: 16, color: '#B91C1C', fontWeight: FONT_WEIGHTS.bold },
  addPerson: { alignSelf: 'flex-start', paddingVertical: 8, marginBottom: 12 },
  addPersonText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#1D4ED8' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1' },
  chipOn: { backgroundColor: '#EFF6FF', borderColor: '#1E3A8A' },
  chipText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#475569' },
  chipTextOn: { color: '#1E3A8A', fontWeight: FONT_WEIGHTS.black },
  optFull: { opacity: 0.5 },
  warn: { fontSize: FONT_SIZES.caption, color: '#B45309', fontWeight: FONT_WEIGHTS.bold, marginBottom: 8 },
  dialogSub: { fontSize: FONT_SIZES.caption, color: '#475569', marginTop: 4, marginBottom: 10 },
  fieldLabel: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#334155', marginBottom: 4 },
  input: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: FONT_SIZES.body, marginBottom: 8 },

  shelterOpt: { padding: 9, borderRadius: 6, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1' },
  shelterOptActive: { backgroundColor: '#EFF6FF', borderColor: '#1E3A8A' },
  shelterOptText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#475569' },
  shelterOptTextActive: { color: '#1E3A8A', fontWeight: FONT_WEIGHTS.black },

  btnCancel: { flex: 1, backgroundColor: '#F1F5F9', padding: 10, borderRadius: 6, alignItems: 'center' },
  btnCancelText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#64748B' },
  btnSubmit: { flex: 2, backgroundColor: '#15803D', padding: 10, borderRadius: 6, alignItems: 'center' },
  btnSubmitText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#FFF' },
});