import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Modal, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomNav from '../../components/BottomNav';
import { FONT_SIZES, FONT_WEIGHTS } from '../../constants/typography';
import { useRescuerFeed } from '../../lib/rescuerFeed';
import { shelterLoad } from '../../lib/location';
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
  const shelterList = feed.centers.map((c) => {
    const load = shelterLoad(c);
    return {
      ...c,
      percent: load.percent,
      status: load.label,
      barColor: load.color,
      ...LOAD_STYLE[load.label],
      tag: [centerTypeLabel(c.raw?.center_type), ...(c.raw?.amenities || [])].filter(Boolean).join(' • '),
    };
  });
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
  const targetShelter = shelterList.find((s) => s.id === targetShelterId) || shelterList[0];

  const handleWalkinAdmission = async () => {
    if (!walkinName.trim() || !walkinBarangayId) {
      return Alert.alert('Required', 'Enter the head of household and their barangay.');
    }
    if (!targetShelter) return Alert.alert('No shelter open', 'There is no open evacuation centre to admit them to.');
    const count = Math.min(50, Math.max(1, parseInt(walkinHeadcount, 10) || 1));
    setSaving(true);
    try {
      await admitWalkIn({
        centerId: targetShelter.id, name: walkinName.trim(), barangayId: walkinBarangayId,
        sitio: walkinSitio.trim(), headcount: count, needs: walkinNeeds.trim(),
      });
      await feed.reload();
    } catch (e) {
      setSaving(false);
      return Alert.alert('Not admitted', e.message);
    }
    setSaving(false);
    setIntakeModalVisible(false);
    setWalkinName('');
    setWalkinBarangayId(null);
    setWalkinSitio('');
    setWalkinHeadcount('1');
    setWalkinNeeds('');

    Alert.alert(
      'Checked in 🏥',
      `${walkinName} (${count} people) checked in at ${targetShelter.name}.`
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sub}>EVACUATION CENTRES</Text>
          <Text style={styles.title}>Centres & evacuees</Text>
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
            {feed.error ? `Could not load shelters: ${feed.error}` : 'No evacuation centre is open right now.'}
          </Text>
        }
        contentContainerStyle={{ padding: 14, gap: 12 }}
        ListHeaderComponent={
          <View style={{ gap: 8, marginBottom: 4 }}>
            <Text style={styles.secTitle}>OPEN CENTRES IN CORDOVA</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.shelterCard}>
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

          </View>
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
              <View style={{ width: 90 }}>
                <Text style={styles.fieldLabel}>HEADCOUNT</Text>
                <TextInput style={styles.input} keyboardType="numeric" value={walkinHeadcount} onChangeText={setWalkinHeadcount} />
              </View>
            </View>

            <Text style={styles.fieldLabel}>SPECIAL NEEDS</Text>
            <TextInput style={styles.input} placeholder="e.g., 1 Senior PWD, 1 Infant" value={walkinNeeds} onChangeText={setWalkinNeeds} />

            <Text style={styles.fieldLabel}>CENTRE</Text>
            <View style={{ gap: 6, marginBottom: 12 }}>
              {shelterList.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.shelterOpt, targetShelter?.id === s.id && styles.shelterOptActive]}
                  onPress={() => setTargetShelterId(s.id)}
                >
                  <Text style={[styles.shelterOptText, targetShelter?.id === s.id && styles.shelterOptTextActive]}>
                    {targetShelter?.id === s.id ? '● ' : '○ '} {s.name} ({Math.max(0, s.capacity - s.occupied)} beds free)
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={styles.btnCancel} onPress={() => setIntakeModalVisible(false)}>
                <Text style={styles.btnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnSubmit} onPress={handleWalkinAdmission} disabled={saving}>
                {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnSubmitText}>Check in</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
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

  btnCancel: { flex: 1, backgroundColor: '#F1F5F9', padding: 10, borderRadius: 6, alignItems: 'center' },
  btnCancelText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#64748B' },
  btnSubmit: { flex: 2, backgroundColor: '#15803D', padding: 10, borderRadius: 6, alignItems: 'center' },
  btnSubmitText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#FFF' },
});