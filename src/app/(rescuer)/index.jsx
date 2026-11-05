import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import BottomNav from '../../components/BottomNav';
import { useRescuerFeed } from '../../lib/rescuerFeed';
import DisasterBanner from '../../components/DisasterBanner';
import { sortResidentsByVPI, getVPITheme } from '../../utils/vpi';

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

export default function RescuerDispatchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [filter, setFilter] = useState('ALL');
  const feed = useRescuerFeed();
  const unitLabel = feed.me?.unitLabel || '—';

  const activeTickets = feed.incidents;

  // My unit's tickets first, then the rest of the active SOS calls, each by vulnerability.
  const sorted = [...sortResidentsByVPI(activeTickets.filter((r) => r.isMine)), ...sortResidentsByVPI(activeTickets.filter((r) => !r.isMine))].filter((r) =>
    filter === 'ALL' ? true : r.priority === filter
  );

  const handleCardPress = (ticket) => {
    router.push({
      pathname: '/(rescuer)/map',
      params: { focusResidentId: ticket.id, focusTs: String(Date.now()) },
    });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      {/* CAD Terminal Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.sub}>CAD TERMINAL • UNIT: {unitLabel.toUpperCase()}</Text>
          <Text style={styles.title}>Incident Dispatch Queue ({sorted.length})</Text>
        </View>
        <TouchableOpacity style={styles.mapBtn} onPress={() => router.replace('/(rescuer)/map')}>
          <Text style={styles.mapBtnText}>🗺️ Map Terminal</Text>
        </TouchableOpacity>
      </View>
      <DisasterBanner events={feed.events} style={{ marginTop: 8 }} />

      {/* VPI Priority Filter Chips */}
      <View style={styles.filterRow}>
        {['ALL', 'CRITICAL', 'ASSISTED', 'LOW'].map((f) => (
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
        data={sorted}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 14, gap: 10 }}
        refreshing={feed.loading}
        onRefresh={feed.reload}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: '#64748B', marginTop: 24 }}>
            {feed.error ? `Could not load the queue: ${feed.error}` : 'No active SOS calls right now.'}
          </Text>
        }
        renderItem={({ item }) => {
          const theme = getVPITheme(item.priority);
          const distFromHome = getDistanceMeters(item.lat, item.lng, item.homeLat, item.homeLng);
          const isDisplaced = distFromHome > 35;
          const isCritical = item.priority === 'CRITICAL' || item.vpiScore >= 80;
          const isAssignedToMe = item.isMine;

          return (
            <TouchableOpacity
              style={[styles.card, isCritical && styles.cardCriticalBorder]}
              onPress={() => handleCardPress(item)}
              activeOpacity={0.85}
            >
              {/* Critical Triage Notice */}
              {isCritical && (
                <View style={styles.criticalStrip}>
                  <Text style={styles.criticalStripText}>
                    ⚡ IMMEDIATE EXTRACTION AUTHORIZED • PARALLEL TRIAGE
                  </Text>
                </View>
              )}

              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.meta}>
                    {item.emergencyType} • Brgy. {item.barangay}{item.sitio ? ` (${item.sitio})` : ''} • {item.reportedAt}
                  </Text>
                </View>
                <View style={[styles.badge, { backgroundColor: theme.color }]}>
                  <Text style={styles.badgeText}>
                    {theme.label} • VPI {item.vpiScore}
                  </Text>
                </View>
              </View>

              {/* Status and Verification Row */}
              <View style={styles.verificationRow}>
                {item.verificationStatus === 'CONFIRMED' ? (
                  <View style={[styles.verifBadge, styles.badgeConfirmed]}>
                    <Text style={styles.verifTextConfirmed}>✓ EOC CONFIRMED</Text>
                  </View>
                ) : (
                  <View style={[styles.verifBadge, styles.badgeUnverified]}>
                    <Text style={styles.verifTextUnverified}>⚠️ CITIZEN SOS (VERIFY ON-SCENE)</Text>
                  </View>
                )}

                {isDisplaced && (
                  <View style={[styles.verifBadge, styles.badgeDisplaced]}>
                    <Text style={styles.verifTextDisplaced}>🏃 DISPLACED ({distFromHome}m AWAY)</Text>
                  </View>
                )}

                {item.duplicateAlert && (
                  <View style={[styles.verifBadge, styles.badgeDuplicate]}>
                    <Text style={styles.verifTextDuplicate}>🔁 REPEATED ALERT</Text>
                  </View>
                )}
              </View>

              {item.landmark ? <Text style={styles.landmark}>🚩 {item.landmark}</Text> : null}

              {/* CAD Action Footer */}
              <View style={styles.cardFooter}>
                <Text style={styles.gearText} numberOfLines={1}>
                  GEAR: {item.requiredGear}
                </Text>
                <View
                  style={[
                    styles.unitPill,
                    isAssignedToMe
                      ? styles.unitAssigned
                      : item.assignedUnit
                      ? styles.unitOther
                      : styles.unitUnassigned,
                  ]}
                >
                  <Text
                    style={[
                      styles.unitText,
                      isAssignedToMe
                        ? styles.unitTextAssigned
                        : item.assignedUnit
                        ? styles.unitTextOther
                        : styles.unitTextUnassigned,
                    ]}
                  >
                    {isAssignedToMe
                      ? '🚑 ASSIGNED TO UNIT • VIEW 📍'
                      : item.assignedUnit
                      ? `${item.assignedUnit} ASSIGNED`
                      : '⏳ AWAITING DISPATCH 📍'}
                  </Text>
                </View>
              </View>
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
  sub: { fontSize: 9.5, fontWeight: '800', color: '#64748B' },
  title: { fontSize: 17, fontWeight: '900', color: '#0F172A' },
  mapBtn: { backgroundColor: '#1E3A8A', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  mapBtnText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  filterRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#FFF' },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, backgroundColor: '#F1F5F9' },
  chipActive: { backgroundColor: '#1E3A8A' },
  chipText: { fontSize: 11, fontWeight: '700', color: '#64748B' },
  chipTextActive: { color: '#FFF', fontWeight: '800' },

  card: { backgroundColor: '#FFF', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', elevation: 2 },
  cardCriticalBorder: { borderColor: '#FCA5A5', borderWidth: 1.5 },
  criticalStrip: { backgroundColor: '#FEF2F2', paddingVertical: 3, paddingHorizontal: 6, borderRadius: 4, marginBottom: 8, borderWidth: 1, borderColor: '#FECACA' },
  criticalStripText: { color: '#DC2626', fontSize: 9, fontWeight: '900' },

  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  name: { fontSize: 15, fontWeight: '900', color: '#0F172A' },
  meta: { fontSize: 11.5, color: '#475569', fontWeight: '600', marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginLeft: 8 },
  badgeText: { color: '#FFF', fontSize: 10, fontWeight: '900' },

  verificationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 },
  verifBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  badgeConfirmed: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  verifTextConfirmed: { fontSize: 9.5, fontWeight: '800', color: '#16A34A' },
  badgeUnverified: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  verifTextUnverified: { fontSize: 9.5, fontWeight: '800', color: '#D97706' },
  badgeDisplaced: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' },
  verifTextDisplaced: { fontSize: 9.5, fontWeight: '800', color: '#1D4ED8' },
  badgeDuplicate: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  verifTextDuplicate: { fontSize: 9.5, fontWeight: '800', color: '#DC2626' },

  landmark: { fontSize: 11, color: '#D97706', fontWeight: '700' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F8FAFC', padding: 8, borderRadius: 6, marginTop: 8 },
  gearText: { fontSize: 10, fontWeight: '800', color: '#DC2626', flex: 1, paddingRight: 6 },
  unitPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  unitAssigned: { backgroundColor: '#DBEAFE' },
  unitOther: { backgroundColor: '#F1F5F9' },
  unitUnassigned: { backgroundColor: '#1E3A8A' },
  unitText: { fontSize: 9.5, fontWeight: '900' },
  unitTextAssigned: { color: '#1E3A8A' },
  unitTextOther: { color: '#64748B' },
  unitTextUnassigned: { color: '#FFF' },
});