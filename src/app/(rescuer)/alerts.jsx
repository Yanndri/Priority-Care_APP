import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import BottomNav from '../../components/BottomNav';
import { FONT_SIZES, FONT_WEIGHTS } from '../../constants/typography';
import { useRescuerFeed } from '../../lib/rescuerFeed';
import DisasterBanner from '../../components/DisasterBanner';
import { reviewHazard } from '../../services/api';

export default function RescuerAlertsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [filter, setFilter] = useState('ALL');
  const feed = useRescuerFeed();
  const hazards = feed.hazards;

  const filteredHazards = hazards.filter((h) => {
    if (filter === 'UNVERIFIED') return h.status === 'unverified' || h.status === 'under_review';
    if (filter === 'CONFIRMED') return h.status === 'confirmed';
    return true;
  });

  const handleLocateHazardOnMap = (hazard) => {
    router.push({
      pathname: '/(rescuer)/map',
      params: { focusHazardId: hazard.id, focusTs: String(Date.now()) },
    });
  };

  const act = async (id, action, note, done) => {
    try {
      await reviewHazard(id, action, note);
      await feed.reload();
      if (done) Alert.alert(...done);
    } catch (e) {
      Alert.alert('Not saved', e.message);
    }
  };

  const handleVerifyHazard = (id) => act(id, 'confirm', 'Verified by field unit',
    ['Hazard Verified ✅', 'Broadcast confirmed across all Cordova route maps.']);

  const handleHoldForReview = (id) => act(id, 'review', 'Held for Barangay Tanod callback verification',
    ['Placed Under Review ⏳', 'Kept in queue for Barangay Tanod callback verification.']);

  const handleDismissHazard = (id) => {
    Alert.alert('Confirm On-Scene False Alarm? 🚫', 'Only mark as False Report if physically inspected on-scene or cleared.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm False Report',
        style: 'destructive',
        onPress: () => act(id, 'dismiss', 'False report: inspected on scene, no hazard found'),
      },
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sub}>TACTICAL HAZARD INTELLIGENCE (MODULE 4.5)</Text>
          <Text style={styles.title}>Active Danger Zones & Road Obstacles</Text>
        </View>
        <TouchableOpacity style={styles.btnOpenShelters} onPress={() => router.push('/(rescuer)/shelters')}>
          <Text style={styles.btnOpenSheltersText}>🏥 Shelters →</Text>
        </TouchableOpacity>
      </View>
      <DisasterBanner events={feed.events} style={{ marginTop: 8 }} />

      {/* Filter Chips */}
      <View style={styles.filterRow}>
        {['ALL', 'UNVERIFIED', 'CONFIRMED'].map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.chip, filter === f && styles.chipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filteredHazards}
        refreshing={feed.loading}
        onRefresh={feed.reload}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: '#64748B', marginTop: 24 }}>
            {feed.error ? `Could not load hazards: ${feed.error}` : 'No open hazard reports in the last 7 days.'}
          </Text>
        }
        keyExtractor={(h) => h.id}
        contentContainerStyle={{ padding: 14, gap: 10 }}
        renderItem={({ item }) => {
          const isConfirmed = item.status === 'confirmed';
          const isReview = item.status === 'under_review';
          return (
            <TouchableOpacity
              style={[styles.hazardCard, isConfirmed && styles.hazardCardConfirmed]}
              activeOpacity={0.85}
              onPress={() => handleLocateHazardOnMap(item)}
            >
              <View style={styles.topRow}>
                <Text style={styles.hazardTitle}>
                  {item.icon} {item.type} ALERT • Brgy. {item.barangay}
                </Text>
                <View style={[styles.badge, isConfirmed ? styles.badgeGreen : styles.badgeAmber]}>
                  <Text style={[styles.badgeText, isConfirmed ? styles.badgeTextGreen : styles.badgeTextAmber]}>
                    {isConfirmed ? '✓ CONFIRMED' : isReview ? '⏳ UNDER REVIEW' : '⚠️ UNVERIFIED'}
                  </Text>
                </View>
              </View>

              <Text style={styles.hazardDesc}>{item.description}</Text>

              <View style={styles.metaRow}>
                <Text style={styles.hazardMeta}>
                  Reported by {item.reportedBy} • {item.time}
                  {item.reviewNote ? `\n✓ Audit: ${item.reviewNote}` : ''}
                </Text>
                <View style={styles.locatePill}>
                  <Text style={styles.locatePillText}>📍 ZOOM MAP</Text>
                </View>
              </View>

              {!isConfirmed && (
                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.btnVerify} onPress={() => handleVerifyHazard(item.id)}>
                    <Text style={styles.btnVerifyText}>✓ Verify</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnReview} onPress={() => handleHoldForReview(item.id)}>
                    <Text style={styles.btnReviewText}>⏳ Review</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnDismiss} onPress={() => handleDismissHazard(item.id)}>
                    <Text style={styles.btnDismissText}>✕ Prank/Clear</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
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
  btnOpenShelters: { backgroundColor: '#1E3A8A', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  btnOpenSheltersText: { color: '#FFF', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold },

  filterRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#FFF' },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, backgroundColor: '#F1F5F9' },
  chipActive: { backgroundColor: '#1E3A8A' },
  chipText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#64748B' },
  chipTextActive: { color: '#FFF', fontWeight: FONT_WEIGHTS.extraBold },

  hazardCard: { backgroundColor: '#FFFBEB', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#FDE68A' },
  hazardCardConfirmed: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hazardTitle: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.black, color: '#0F172A', flex: 1, paddingRight: 6 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  badgeAmber: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  badgeGreen: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  badgeText: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold },
  badgeTextAmber: { color: '#D97706' },
  badgeTextGreen: { color: '#16A34A' },

  hazardDesc: { fontSize: FONT_SIZES.caption, color: '#334155', marginTop: 6 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  hazardMeta: { fontSize: FONT_SIZES.tiny, color: '#64748B', fontWeight: FONT_WEIGHTS.bold, flex: 1, paddingRight: 8 },
  locatePill: { backgroundColor: '#1E3A8A', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  locatePillText: { color: '#FFF', fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold },

  actionRow: { flexDirection: 'row', gap: 6, marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderColor: '#FDE68A' },
  btnVerify: { flex: 1, backgroundColor: '#16A34A', paddingVertical: 7, borderRadius: 6, alignItems: 'center' },
  btnVerifyText: { color: '#FFF', fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold },
  btnReview: { flex: 1, backgroundColor: '#D97706', paddingVertical: 7, borderRadius: 6, alignItems: 'center' },
  btnReviewText: { color: '#FFF', fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold },
  btnDismiss: { flex: 1, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CBD5E1', paddingVertical: 7, borderRadius: 6, alignItems: 'center' },
  btnDismissText: { color: '#DC2626', fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold },
});