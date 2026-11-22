import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Modal, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomNav from '../../components/BottomNav';
import { FONT_SIZES, FONT_WEIGHTS } from '../../constants/typography';
import { useRescuerFeed } from '../../lib/rescuerFeed';
import { getCurrentCoords, distanceMeters, formatDistance } from '../../lib/location';
import { centerTypeLabel } from '../../lib/mapData';
import { useCenterAvailability } from '../../lib/centerAvailability';
import { admitWalkIn } from '../../services/api';
import CenterRosterSheet from '../../components/CenterRosterSheet';

const LOAD_STYLE = {
  OPEN: { statusBg: '#DCFCE7', statusColor: '#15803D', barColor: '#16A34A' },
  'NEAR CAPACITY': { statusBg: '#FEF3C7', statusColor: '#B45309', barColor: '#D97706' },
  FULL: { statusBg: '#FEE2E2', statusColor: '#B91C1C', barColor: '#DC2626' },
};

export default function RescuerSheltersScreen() {
  const insets = useSafeAreaInsets();
  const feed = useRescuerFeed();
  const avail = useCenterAvailability();
  const [myPos, setMyPos] = useState(null);
  const [openCenter, setOpenCenter] = useState(null);

  // Rough position, only to sort centres by distance and pick the nearest one for walk-ins.
  useEffect(() => {
    getCurrentCoords({ timeoutMs: 8000 }).then((c) => c && setMyPos(c)).catch(() => {});
  }, []);

  // Free spaces count seats already reserved for households a rescuer is bringing in,
  // the same rule the server uses when it accepts a walk-in.
  const shelterList = useMemo(() => feed.centers.map((c) => {
    const a = avail.byId[c.id];
    const capacity = a?.capacity ?? c.capacity;
    const occupied = a?.occupied ?? c.occupied;
    const reserved = a?.reserved ?? 0;
    const free = a ? a.available : Math.max(0, capacity - occupied);
    const percent = capacity ? Math.min(100, Math.round(((occupied + reserved) / capacity) * 100)) : 0;
    const status = free <= 0 ? 'FULL' : percent >= 80 ? 'NEAR CAPACITY' : 'OPEN';
    return {
      ...c,
      capacity, occupied, reserved, free, percent, status,
      ...LOAD_STYLE[status],
      distance: myPos ? distanceMeters(myPos, c) : null,
      tag: [centerTypeLabel(c.raw?.center_type), ...(c.raw?.amenities || [])].filter(Boolean).join(' • '),
    };
  }).sort((x, y) => (x.distance == null || y.distance == null ? 0 : x.distance - y.distance)),
  [feed.centers, avail.byId, myPos]);

  const totals = shelterList.reduce((t, c) => ({
    capacity: t.capacity + c.capacity, free: t.free + c.free, inside: t.inside + c.occupied, full: t.full + (c.free <= 0 ? 1 : 0),
  }), { capacity: 0, free: 0, inside: 0, full: 0 });

  const barangays = Object.entries(feed.barangayNames).map(([id, name]) => ({ id: Number(id), name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const [intakeModalVisible, setIntakeModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  // Manual Walk-In Intake Form State
  const [walkinName, setWalkinName] = useState('');
  const [walkinBarangayId, setWalkinBarangayId] = useState(null);
  const [walkinSitio, setWalkinSitio] = useState('');
  const [walkinHeadcount, setWalkinHeadcount] = useState('1');
  const [walkinNeeds, setWalkinNeeds] = useState('');
  const [targetShelterId, setTargetShelterId] = useState(null);
  const count = Math.min(50, Math.max(1, parseInt(walkinHeadcount, 10) || 1));
  // Default: the nearest centre with room for the whole group (the list is sorted by distance).
  const chosen = shelterList.find((s) => s.id === targetShelterId);
  const targetShelter = chosen || shelterList.find((s) => s.free >= count) || null;

  const myBarangayId = feed.me?.units?.[0]?.barangay_id ?? null;
  const openIntake = () => {
    setTargetShelterId(null);
    if (walkinBarangayId == null && myBarangayId != null) setWalkinBarangayId(myBarangayId);
    setIntakeModalVisible(true);
    getCurrentCoords({ timeoutMs: 8000 }).then((c) => c && setMyPos(c)).catch(() => {});
  };

  const handleWalkinAdmission = async () => {
    if (!walkinName.trim() || !walkinBarangayId) {
      return Alert.alert('Required', 'Enter the head of household and their barangay.');
    }
    if (!targetShelter) return Alert.alert('No space', `No open evacuation centre has room for ${count} people.`);
    if (targetShelter.free < count) {
      return Alert.alert('Not enough space', targetShelter.free === 0
        ? `${targetShelter.name} is full. Choose another centre.`
        : `${targetShelter.name} has only ${targetShelter.free} spaces left. Choose another centre.`);
    }
    const name = walkinName.trim();
    setSaving(true);
    try {
      await admitWalkIn({
        centerId: targetShelter.id, name, barangayId: walkinBarangayId,
        sitio: walkinSitio.trim(), headcount: count, needs: walkinNeeds.trim(),
      });
      await Promise.all([feed.reload(), avail.reload()]);
    } catch (e) {
      setSaving(false);
      avail.reload();
      return Alert.alert('Not checked in', e.message);
    }
    setSaving(false);
    setIntakeModalVisible(false);
    setWalkinName('');
    setWalkinBarangayId(null);
    setWalkinSitio('');
    setWalkinHeadcount('1');
    setWalkinNeeds('');
    setTargetShelterId(null);

    Alert.alert('Checked in 🏥', `${name} (${count} ${count === 1 ? 'person' : 'people'}) checked in at ${targetShelter.name}.`);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sub}>EVACUATION CENTRES</Text>
          <Text style={styles.title}>Centres & evacuees</Text>
        </View>
        <TouchableOpacity style={styles.btnWalkin} onPress={openIntake}>
          <Text style={styles.btnWalkinText}>➕ Add walk-in</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={shelterList}
        keyExtractor={(item) => String(item.id)}
        refreshing={feed.loading}
        onRefresh={() => { feed.reload(); avail.reload(); }}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: '#64748B', marginTop: 16 }}>
            {feed.error ? `Could not load shelters: ${feed.error}` : 'No evacuation centre is open right now.'}
          </Text>
        }
        contentContainerStyle={{ padding: 14, gap: 12 }}
        ListHeaderComponent={
          <View style={{ gap: 8, marginBottom: 4 }}>
            {shelterList.length > 0 && (
              <View style={styles.summary}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryNum}>{totals.free}</Text>
                  <Text style={styles.summaryLabel}>spaces free of {totals.capacity}</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryNum}>{totals.inside}</Text>
                  <Text style={styles.summaryLabel}>people sheltered</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryNum, totals.full > 0 && { color: '#B91C1C' }]}>{totals.full}</Text>
                  <Text style={styles.summaryLabel}>{totals.full === 1 ? 'centre full' : 'centres full'}</Text>
                </View>
              </View>
            )}
            <Text style={styles.secTitle}>{myPos ? 'OPEN CENTRES, NEAREST FIRST • TAP ONE TO SEE WHO IS INSIDE' : 'OPEN CENTRES • TAP ONE TO SEE WHO IS INSIDE'}</Text>
            {feed.fromCache && <Text style={styles.offlineText}>Offline: showing the last saved numbers.</Text>}
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.shelterCard} onPress={() => setOpenCenter(item)} accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${item.free} spaces free. Open to see who is inside.`}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.shelterName}>{item.name}</Text>
                <Text style={styles.shelterTag}>
                  {[item.distance != null ? formatDistance(item.distance) : null, item.tag].filter(Boolean).join(' • ')}
                </Text>
              </View>
              <View style={[styles.badge, { backgroundColor: item.statusBg, borderColor: item.barColor }]}>
                <Text style={[styles.badgeText, { color: item.statusColor }]}>{item.status}</Text>
              </View>
            </View>

            {/* Occupancy: people inside plus seats reserved for households on the way */}
            <View style={styles.occupancyRow}>
              <Text style={[styles.freeText, item.free <= 0 && { color: '#B91C1C' }]}>
                {item.free <= 0 ? 'No spaces left' : `${item.free} of ${item.capacity} spaces free`}
              </Text>
            </View>
            <View style={styles.barBg}>
              <View style={{ height: '100%', width: `${item.percent}%`, backgroundColor: item.barColor }} />
            </View>
            <View style={styles.cardBottom}>
              <Text style={styles.occupancyText}>
                {item.occupied} inside{item.reserved > 0 ? ` • ${item.reserved} on the way` : ''}
              </Text>
              <Text style={styles.seeWho}>See who's inside ›</Text>
            </View>
          </TouchableOpacity>
        )}
      />

      {/* Manual Walk-In Intake Form Modal */}
      <Modal visible={intakeModalVisible} transparent animationType="slide">
        <View style={styles.modalBg}>
          {/* Scrolls so "Check in" stays reachable on small phones (it used to fall off-screen). */}
          <ScrollView style={styles.dialog} contentContainerStyle={{ paddingBottom: 4 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.dialogTitle}>📝 ADD A WALK-IN EVACUEE</Text>
            <Text style={styles.dialogSub}>
              For families who came to the centre on their own:
            </Text>

            <Text style={styles.fieldLabel}>HEAD OF HOUSEHOLD NAME</Text>
            <TextInput style={styles.input} placeholder="Full Name" value={walkinName} onChangeText={setWalkinName} />

            <Text style={styles.fieldLabel}>BARANGAY OF ORIGIN</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 4 }}>
              {barangays.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  style={[styles.shelterOpt, walkinBarangayId === b.id && styles.shelterOptActive]}
                  onPress={() => setWalkinBarangayId(b.id)}
                >
                  <Text style={[styles.shelterOptText, walkinBarangayId === b.id && styles.shelterOptTextActive]}>{b.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>SITIO / LANDMARK (OPTIONAL)</Text>
                <TextInput style={styles.input} placeholder="e.g., Sitio Riverside" value={walkinSitio} onChangeText={setWalkinSitio} />
              </View>
            </View>

            <Text style={styles.fieldLabel}>HOW MANY PEOPLE</Text>
            <View style={styles.stepper}>
              <TouchableOpacity style={styles.stepBtn} onPress={() => setWalkinHeadcount(String(Math.max(1, count - 1)))} accessibilityLabel="One fewer">
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepValue}>{count}</Text>
              <TouchableOpacity style={styles.stepBtn} onPress={() => setWalkinHeadcount(String(Math.min(50, count + 1)))} accessibilityLabel="One more">
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>SPECIAL NEEDS</Text>
            <TextInput style={styles.input} placeholder="e.g., 1 Senior PWD, 1 Infant" value={walkinNeeds} onChangeText={setWalkinNeeds} />

            <Text style={styles.fieldLabel}>CENTRE {myPos ? '(NEAREST FIRST)' : ''}</Text>
            <View style={{ gap: 6, marginBottom: 12 }}>
              {shelterList.map((s) => {
                const fits = s.free >= count;
                const on = targetShelter?.id === s.id;
                return (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.shelterOpt, on && styles.shelterOptActive, !fits && styles.shelterOptFull]}
                    onPress={() => fits && setTargetShelterId(s.id)}
                    disabled={!fits}
                    accessibilityState={{ selected: on, disabled: !fits }}
                  >
                    <Text style={[styles.shelterOptText, on && styles.shelterOptTextActive, !fits && styles.shelterOptTextFull]}>
                      {on ? '● ' : '○ '}{s.name}
                    </Text>
                    <Text style={[styles.shelterOptMeta, !fits && styles.shelterOptTextFull]}>
                      {[s.distance != null ? formatDistance(s.distance) : null,
                        s.free <= 0 ? 'Full' : fits ? `${s.free} spaces free` : `Only ${s.free} spaces left`].filter(Boolean).join(' • ')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={styles.btnCancel} onPress={() => setIntakeModalVisible(false)}>
                <Text style={styles.btnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnSubmit, !targetShelter && { opacity: 0.5 }]} onPress={handleWalkinAdmission} disabled={saving}>
                {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnSubmitText}>
                  {targetShelter ? `Check in at ${targetShelter.name}` : 'No centre has room'}
                </Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <CenterRosterSheet
        center={openCenter}
        onClose={() => setOpenCenter(null)}
        onChanged={() => { feed.reload(); avail.reload(); }}
      />

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
  occupancyText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#475569' },
  summary: { flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', paddingVertical: 10 },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryNum: { fontSize: 22, fontWeight: FONT_WEIGHTS.black, color: '#0F172A' },
  summaryLabel: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.bold, color: '#64748B', textAlign: 'center' },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  seeWho: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#1D4ED8' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 18, marginBottom: 10 },
  stepBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { fontSize: 22, fontWeight: '800', color: '#1E3A8A' },
  stepValue: { fontSize: 22, fontWeight: '800', color: '#0F172A', minWidth: 32, textAlign: 'center' },
  freeText: { fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.extraBold, color: '#15803D' },
  offlineText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#B45309' },
  slotsLeftText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#15803D' },
  barBg: { height: 8, backgroundColor: '#E2E8F0', borderRadius: 4, overflow: 'hidden', marginVertical: 6 },
  catchmentText: { fontSize: FONT_SIZES.caption, color: '#475569', marginTop: 4 },


  modalBg: { flex: 1, backgroundColor: 'rgba(15,23,42,0.7)', justifyContent: 'center', padding: 18 },
  dialog: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, maxHeight: '90%', flexGrow: 0 },
  dialogTitle: { fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.black, color: '#1E3A8A' },
  dialogSub: { fontSize: FONT_SIZES.caption, color: '#475569', marginTop: 4, marginBottom: 10 },
  fieldLabel: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#475569', marginBottom: 4 },
  input: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: FONT_SIZES.body, marginBottom: 8 },

  shelterOpt: { padding: 9, borderRadius: 6, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1' },
  shelterOptActive: { backgroundColor: '#EFF6FF', borderColor: '#1E3A8A' },
  shelterOptText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#475569' },
  shelterOptTextActive: { color: '#1E3A8A', fontWeight: FONT_WEIGHTS.black },
  shelterOptFull: { backgroundColor: '#F1F5F9', borderColor: '#E2E8F0' },
  shelterOptTextFull: { color: '#94A3B8' },
  shelterOptMeta: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.bold, color: '#64748B', marginTop: 2, marginLeft: 16 },

  btnCancel: { flex: 1, backgroundColor: '#F1F5F9', padding: 10, borderRadius: 6, alignItems: 'center' },
  btnCancelText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#64748B' },
  btnSubmit: { flex: 2, backgroundColor: '#15803D', padding: 10, borderRadius: 6, alignItems: 'center' },
  btnSubmitText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#FFF' },
});