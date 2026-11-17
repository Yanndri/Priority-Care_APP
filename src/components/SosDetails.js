// What the responder needs to know about an SOS before going: the emergency, when it was sent,
// how many people, the resident's own note, the MDRRMO's instructions and what to bring.
// Used on the SOS list card, the map card and the Info sheet.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function SosDetails({ res, style, title = 'SOS DETAILS' }) {
  if (!res) return null;
  const rows = [
    ['🚨', 'Emergency', [res.emergencyType, res.reportedAt && `sent ${res.reportedAt}`].filter(Boolean).join(' • ')],
    ['👥', 'People', res.householdSize ? `${res.householdSize} ${res.householdSize === 1 ? 'person' : 'people'}` : null],
    ['📝', 'Resident says', res.note || 'No note from the resident'],
    ['📋', 'MDRRMO says', res.instructions],
    ['🎒', 'Bring', res.requiredGear],
    ['🚩', 'Landmark', res.landmark],
  ].filter(([, , v]) => v);
  return (
    <View style={[styles.box, style]}>
      <Text style={styles.title}>{title}</Text>
      {rows.map(([icon, label, value]) => (
        <View key={label} style={styles.row}>
          <Text style={styles.icon}>{icon}</Text>
          <Text style={styles.text}>
            <Text style={styles.label}>{label}: </Text>
            <Text style={[styles.value, label === 'Resident says' && !res.note && styles.muted]}>{value}</Text>
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, padding: 8, gap: 3 },
  title: { fontSize: 10, fontWeight: '900', color: '#475569', letterSpacing: 0.4, marginBottom: 2 },
  row: { flexDirection: 'row', gap: 6 },
  icon: { fontSize: 13, width: 18 },
  text: { flex: 1, fontSize: 13, color: '#0F172A' },
  label: { fontWeight: '800', color: '#334155' },
  value: { fontWeight: '600' },
  muted: { color: '#94A3B8', fontStyle: 'italic' },
});
