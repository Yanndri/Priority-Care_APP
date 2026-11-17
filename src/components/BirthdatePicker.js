// Birthdate field: tap to pick month, day and year from lists (no typing).
// value / onChange use the same 'YYYY-MM-DD' string the registration already sends.
import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ROW_H = 44;
const pad = (n) => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(y || 2000, m + 1, 0).getDate(); // m is 0-based; leap years handled

function parse(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) } : null;
}

export function formatBirthdate(value) {
  const p = parse(value);
  return p ? `${MONTHS[p.m]} ${p.d}, ${p.y}` : '';
}

function Column({ items, selected, onSelect, label, open }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const i = items.findIndex((it) => it.value === selected);
    const t = setTimeout(() => ref.current?.scrollTo({ y: Math.max(0, (i - 2) * ROW_H), animated: false }), 50);
    return () => clearTimeout(t);
  }, [open]);
  return (
    <View style={styles.col}>
      <Text style={styles.colLabel}>{label}</Text>
      <ScrollView ref={ref} style={styles.list} showsVerticalScrollIndicator={false}>
        {items.map((it) => {
          const on = it.value === selected;
          return (
            <TouchableOpacity key={it.value} style={[styles.item, on && styles.itemOn]} onPress={() => onSelect(it.value)}>
              <Text style={[styles.itemText, on && styles.itemTextOn]}>{it.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function BirthdatePicker({ value, onChange, hasError, onLayout }) {
  const [open, setOpen] = useState(false);
  const [y, setY] = useState(null);
  const [m, setM] = useState(null);
  const [d, setD] = useState(null);

  const today = new Date();
  const thisYear = today.getFullYear();

  const show = () => {
    const p = parse(value);
    setY(p ? p.y : null); setM(p ? p.m : null); setD(p ? p.d : null);
    setOpen(true);
  };

  // Keep the day valid when the month or year changes (e.g. 31 -> February).
  useEffect(() => {
    if (d != null && m != null && d > daysIn(y, m)) setD(daysIn(y, m));
  }, [y, m]);

  const years = Array.from({ length: 111 }, (_, i) => ({ value: thisYear - i, label: String(thisYear - i) }));
  const months = MONTHS.map((name, i) => ({ value: i, label: name }));
  const days = Array.from({ length: m == null ? 31 : daysIn(y, m) }, (_, i) => ({ value: i + 1, label: String(i + 1) }));

  const complete = y != null && m != null && d != null;
  const future = complete && new Date(y, m, d) > today;

  const save = () => {
    if (!complete || future) return;
    onChange(`${y}-${pad(m + 1)}-${pad(d)}`);
    setOpen(false);
  };

  const text = formatBirthdate(value);
  return (
    <>
      <TouchableOpacity style={[styles.field, hasError && styles.fieldError]} onPress={show} onLayout={onLayout} activeOpacity={0.7}>
        <Text style={[styles.fieldText, !text && styles.placeholder]}>{text || 'Birthdate'}</Text>
        <Text style={styles.icon}>📅</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.title}>Select your birthdate</Text>
            <View style={styles.cols}>
              <Column label="MONTH" items={months} selected={m} onSelect={setM} open={open} />
              <Column label="DAY" items={days} selected={d} onSelect={setD} open={open} />
              <Column label="YEAR" items={years} selected={y} onSelect={setY} open={open} />
            </View>
            {future && <Text style={styles.warn}>Birthdate can't be in the future.</Text>}
            <View style={styles.buttons}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setOpen(false)}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnPrimary, (!complete || future) && { opacity: 0.4 }]} disabled={!complete || future} onPress={save}>
                <Text style={styles.btnPrimaryText}>
                  {complete ? `Set ${MONTHS[m].slice(0, 3)} ${d}, ${y}` : 'Pick month, day and year'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11, marginTop: 8, marginBottom: 8 },
  fieldError: { borderColor: '#DC2626' },
  fieldText: { fontSize: 14, color: '#0F172A', fontWeight: '500' },
  placeholder: { color: '#94A3B8' },
  icon: { fontSize: 16 },
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: '#FFF', borderRadius: 12, padding: 16 },
  title: { fontSize: 16, fontWeight: '900', color: '#0F172A', marginBottom: 10 },
  cols: { flexDirection: 'row', gap: 8 },
  col: { flex: 1 },
  colLabel: { fontSize: 11, fontWeight: '800', color: '#64748B', marginBottom: 4, textAlign: 'center' },
  list: { height: ROW_H * 5, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8 },
  item: { height: ROW_H, alignItems: 'center', justifyContent: 'center' },
  itemOn: { backgroundColor: '#1E3A8A' },
  itemText: { fontSize: 14, color: '#1E293B' },
  itemTextOn: { color: '#FFF', fontWeight: '800' },
  warn: { color: '#DC2626', fontSize: 12, fontWeight: '700', marginTop: 8 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 14 },
  btn: { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  btnGhost: { borderWidth: 1, borderColor: '#CBD5E1' },
  btnGhostText: { fontWeight: '800', color: '#1E293B' },
  btnPrimary: { backgroundColor: '#1E3A8A', flex: 2 },
  btnPrimaryText: { color: '#FFF', fontWeight: '900' },
});
