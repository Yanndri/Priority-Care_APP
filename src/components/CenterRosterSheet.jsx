// Who is inside one evacuation centre, grouped by household, with the needs staff must plan for
// (seniors, infants, pregnant women, people who cannot walk). Rescuers tick who is leaving and
// check them out, which frees their spaces right away.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { FONT_SIZES, FONT_WEIGHTS } from '../constants/typography';
import { getCenterRoster, checkOutEvacuees } from '../services/api';

const AGE_LABEL = { infant: 'Infant', child: 'Child', senior: 'Senior' };

function flagsFor(p) {
  const flags = [];
  if (AGE_LABEL[p.age_group]) flags.push(AGE_LABEL[p.age_group]);
  if (p.pregnant) flags.push('Pregnant');
  if (p.mobility) flags.push(p.mobility);
  return flags;
}

export default function CenterRosterSheet({ center, onClose, onChanged }) {
  const [roster, setRoster] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    if (!center) return;
    try {
      setRoster(await getCenterRoster(center.id));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [center]);

  useEffect(() => {
    setRoster(null); setPicked(new Set()); setConfirming(false); setDone(''); setError('');
    load();
  }, [load]);

  // Households (and walk-in groups) in the order they arrived, newest first.
  const groups = useMemo(() => {
    const map = new Map();
    for (const p of roster?.people || []) {
      if (!map.has(p.group_id)) map.set(p.group_id, { id: p.group_id, label: p.group_label, barangay: p.barangay_name, sitio: p.sitio, people: [] });
      map.get(p.group_id).people.push(p);
    }
    return [...map.values()];
  }, [roster]);

  const people = roster?.people || [];
  const total = people.reduce((n, p) => n + (p.headcount || 1), 0);
  const needCounts = useMemo(() => {
    const c = { Senior: 0, Infant: 0, Child: 0, Pregnant: 0, 'Mobility help': 0 };
    for (const p of people) {
      if (p.age_group === 'senior') c.Senior += 1;
      if (p.age_group === 'infant') c.Infant += 1;
      if (p.age_group === 'child') c.Child += 1;
      if (p.pregnant) c.Pregnant += 1;
      if (p.mobility) c['Mobility help'] += 1;
    }
    return Object.entries(c).filter(([, n]) => n > 0);
  }, [people]);

  const pickedCount = people.filter((p) => picked.has(p.record_id)).reduce((n, p) => n + (p.headcount || 1), 0);

  const toggle = (ids) => {
    setConfirming(false);
    setPicked((prev) => {
      const next = new Set(prev);
      const allOn = ids.every((id) => next.has(id));
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const checkOut = async () => {
    if (!confirming) return setConfirming(true);
    setBusy(true);
    try {
      await checkOutEvacuees(center.id, [...picked]);
      setDone(`${pickedCount} ${pickedCount === 1 ? 'person' : 'people'} checked out. Their spaces are free again.`);
      setPicked(new Set());
      setConfirming(false);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={!!center} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.bg}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{center?.name}</Text>
              <Text style={styles.sub}>
                {roster ? `${total} inside • ${Math.max(0, (roster.capacity || 0) - (roster.occupied || 0) - (roster.reserved || 0))} of ${roster.capacity} spaces free` : 'Loading…'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.close} accessibilityLabel="Close">
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {needCounts.length > 0 && (
            <View style={styles.needsRow}>
              {needCounts.map(([k, n]) => (
                <View key={k} style={styles.needChip}><Text style={styles.needChipText}>{n} {k}</Text></View>
              ))}
            </View>
          )}

          {!!error && <Text style={styles.error}>{error}</Text>}
          {!!done && <Text style={styles.done}>✅ {done}</Text>}

          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
            {!roster && !error && <ActivityIndicator style={{ marginVertical: 24 }} color="#1E3A8A" />}
            {roster && groups.length === 0 && <Text style={styles.empty}>Nobody is checked in here.</Text>}
            {groups.map((g) => {
              const ids = g.people.map((p) => p.record_id);
              const allOn = ids.every((id) => picked.has(id));
              return (
                <View key={g.id} style={styles.group}>
                  <TouchableOpacity style={styles.groupHead} onPress={() => toggle(ids)} accessibilityRole="checkbox" accessibilityState={{ checked: allOn }}>
                    <Text style={[styles.box, allOn && styles.boxOn]}>{allOn ? '✓' : ''}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.groupLabel}>
                        {g.people[0].kind === 'walkin' ? `${g.label} (walk-in, ${g.people[0].headcount} ${g.people[0].headcount === 1 ? 'person' : 'people'})` : `${g.label} household`}
                      </Text>
                      <Text style={styles.groupMeta}>{[g.sitio, g.barangay].filter(Boolean).join(', ')}</Text>
                    </View>
                  </TouchableOpacity>
                  {g.people[0].kind === 'walkin' ? (
                    g.people[0].needs ? <Text style={styles.needsText}>Needs: {g.people[0].needs}</Text> : null
                  ) : g.people.map((p) => {
                    const on = picked.has(p.record_id);
                    const flags = flagsFor(p);
                    return (
                      <TouchableOpacity key={p.record_id} style={styles.person} onPress={() => toggle([p.record_id])} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                        <Text style={[styles.boxSmall, on && styles.boxOn]}>{on ? '✓' : ''}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.personName}>{p.name} <Text style={styles.rel}>· {p.relationship}</Text></Text>
                          {(flags.length > 0 || p.needs) && (
                            <View style={styles.flagRow}>
                              {flags.map((f) => <Text key={f} style={styles.flag}>{f}</Text>)}
                              {p.needs ? <Text style={styles.needsInline}>{p.needs}</Text> : null}
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })}
          </ScrollView>

          {picked.size > 0 && (
            <TouchableOpacity style={[styles.checkout, confirming && styles.checkoutConfirm]} onPress={checkOut} disabled={busy}>
              {busy ? <ActivityIndicator color="#FFF" /> : (
                <Text style={styles.checkoutText}>
                  {confirming ? `Tap again: ${pickedCount} ${pickedCount === 1 ? 'person has' : 'people have'} left` : `Check out ${pickedCount} ${pickedCount === 1 ? 'person' : 'people'}`}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFF', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '88%', gap: 10 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  title: { fontSize: FONT_SIZES.title, fontWeight: FONT_WEIGHTS.black, color: '#1E3A8A' },
  sub: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#475569', marginTop: 2 },
  close: { padding: 6 },
  closeText: { fontSize: 20, color: '#64748B' },
  needsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  needChip: { backgroundColor: '#FEF3C7', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  needChipText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#92400E' },
  error: { color: '#B91C1C', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold },
  done: { color: '#15803D', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold },
  empty: { textAlign: 'center', color: '#64748B', marginVertical: 24 },
  group: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 10, gap: 6 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  groupLabel: { fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.extraBold, color: '#0F172A' },
  groupMeta: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.bold, color: '#64748B' },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: '#94A3B8', textAlign: 'center', lineHeight: 20, color: '#FFF', fontWeight: '900' },
  boxSmall: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: '#CBD5E1', textAlign: 'center', lineHeight: 16, color: '#FFF', fontWeight: '900', marginLeft: 4 },
  boxOn: { backgroundColor: '#1E3A8A', borderColor: '#1E3A8A' },
  person: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingLeft: 4, paddingVertical: 2 },
  personName: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.bold, color: '#0F172A' },
  rel: { fontWeight: FONT_WEIGHTS.bold, color: '#64748B' },
  flagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3 },
  flag: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#92400E', backgroundColor: '#FEF3C7', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  needsInline: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.bold, color: '#475569' },
  needsText: { fontSize: FONT_SIZES.caption, color: '#475569', paddingLeft: 34 },
  checkout: { backgroundColor: '#1E3A8A', borderRadius: 10, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  checkoutConfirm: { backgroundColor: '#B45309' },
  checkoutText: { color: '#FFF', fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.extraBold },
});
