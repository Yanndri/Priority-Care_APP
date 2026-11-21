import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Image, Modal, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useNavigation } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import BottomNav from '../../components/BottomNav';
import { useSession } from '../../components/SessionProvider';
import { RESIDENT_CATEGORIES, RESIDENT_MOBILITIES } from '../../constants/mockData';
import { FONT_SIZES, FONT_WEIGHTS } from '../../constants/typography';
import {
  listBarangays, memberToApp, memberToDb, setMyHousePhoto, signedPhotoUrl, signOut, updateMyHousehold,
} from '../../services/api';
import { getCurrentCoords } from '../../lib/location';
import HomeLocationPicker from '../../components/HomeLocationPicker';
import ChangePasscode from '../../components/ChangePasscode';

// What the screen edits, built from get_my_profile.
function formFromProfile(profile) {
  const r = profile?.resident || {};
  return {
    repName: [profile?.f_name, profile?.m_name, profile?.l_name].filter(Boolean).join(' '),
    contact: profile?.contact_no || '',
    contact2: r.emerg_contact_no || '',
    barangay: r.barangay_name || '',
    sitio: r.sitio || '',
    landmark: r.landmark || '',
    homeLat: r.gps_lat != null ? Number(r.gps_lat) : null,
    homeLng: r.gps_long != null ? Number(r.gps_long) : null,
    facadeUri: null,
    members: (profile?.household?.members || []).map(memberToApp),
  };
}

export default function ResidentProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const { profile, refresh } = useSession();
  const isHead = profile?.household?.is_head !== false;
  const initial = useMemo(() => formFromProfile(profile), [profile]);

  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [facadeAsset, setFacadeAsset] = useState(null);
  const [draft, setDraft] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savingPin, setSavingPin] = useState(false);

  // Reload the form when the profile changes (after saving or signing in).
  useEffect(() => {
    let alive = true;
    signedPhotoUrl('house-facades', profile?.resident?.house_photo_path).then((url) => {
      if (!alive) return;
      const next = { ...initial, facadeUri: url };
      setForm(next);
      setSaved(next);
      setFacadeAsset(null);
    });
    return () => { alive = false; };
  }, [initial, profile?.resident?.house_photo_path]);

  const isModified = JSON.stringify(form) !== JSON.stringify(saved);
  const setField = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));

  // Intercept navigation when unsaved edits exist
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!isModified) return;
      e.preventDefault();

      Alert.alert(
        'Unsaved Changes ⚠️',
        'You have unsaved household updates. What would you like to do before leaving?',
        [
          { text: 'Keep Editing', style: 'cancel' },
          { text: 'Discard Changes', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
          {
            text: 'Save & Leave',
            onPress: async () => {
              if (await handleSaveProfile()) navigation.dispatch(e.data.action);
            },
          },
        ]
      );
    });

    return unsubscribe;
  }, [navigation, isModified, form]);

  const handleRecalibrateLocation = () => {
    Alert.alert(
      'Update home location 📍',
      'Where should we get it from?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Use Barangay Centre',
          onPress: async () => {
            try {
              const list = await listBarangays();
              const b = list.find((x) => x.barangay_id === profile?.resident?.barangay_id);
              if (!b?.center_lat) throw new Error('This barangay has no centre point yet.');
              setForm((p) => ({ ...p, homeLat: Number(b.center_lat), homeLng: Number(b.center_lng) }));
              Alert.alert('Location updated', `Set to the centre of Brgy. ${b.barangay_name}.`);
            } catch (e) {
              Alert.alert('Not updated', e.message);
            }
          },
        },
        {
          text: 'Use my phone GPS',
          onPress: async () => {
            const fix = await getCurrentCoords({ precise: true, timeoutMs: 20000 });
            if (!fix) return Alert.alert('No GPS fix', 'Allow location access and try again outdoors or near a window.');
            setForm((p) => ({ ...p, homeLat: fix.lat, homeLng: fix.lng }));
            Alert.alert('Location saved 📍', `Set to:\nLat: ${fix.lat.toFixed(5)}, Lng: ${fix.lng.toFixed(5)}`);
          },
        },
      ]
    );
  };

  // "Use My Current Location": the pin is saved to the database straight away.
  const handleSavePin = async (p) => {
    if (!isHead) {
      setPickerOpen(false);
      return Alert.alert('View only', 'Only the household head can change the home location.');
    }
    setSavingPin(true);
    try {
      await updateMyHousehold({ gps_lat: p.lat, gps_long: p.lng });
      const otherEdits = JSON.stringify({ ...form, homeLat: null, homeLng: null }) !== JSON.stringify({ ...saved, homeLat: null, homeLng: null });
      setForm((f) => ({ ...f, homeLat: p.lat, homeLng: p.lng }));
      setSaved((s) => ({ ...s, homeLat: p.lat, homeLng: p.lng }));
      // Reload the profile so the maps use the new pin, unless that would wipe other unsaved edits.
      if (!otherEdits) await refresh();
      setPickerOpen(false);
      Alert.alert('Home location saved 📍', `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}${p.accuracy != null ? ` (GPS ±${p.accuracy} m)` : ' (placed on the map)'}`);
    } catch (e) {
      Alert.alert('Location not saved', e.message);
    } finally {
      setSavingPin(false);
    }
  };

  const handleCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') return Alert.alert('Permission Denied', 'Camera access is required.');

    const res = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.7 });
    if (!res.canceled && res.assets?.[0]?.uri) {
      setFacadeAsset(res.assets[0]);
      setField('facadeUri', res.assets[0].uri);
    }
  };

  const handleGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return Alert.alert('Permission Denied', 'Photo library access is required.');

    const res = await ImagePicker.launchImageLibraryAsync({ allowsEditing: false, quality: 0.7 });
    if (!res.canceled && res.assets?.[0]?.uri) {
      setFacadeAsset(res.assets[0]);
      setField('facadeUri', res.assets[0].uri);
    }
  };

  const handleSaveDraft = () => {
    if (!draft.name?.trim()) return Alert.alert('Required', 'Please enter a family member name.');
    const cat = RESIDENT_CATEGORIES.find((c) => c.id === draft.category) || RESIDENT_CATEGORIES[0];
    const mob = RESIDENT_MOBILITIES.find((m) => m.id === draft.mobility) || RESIDENT_MOBILITIES[0];
    const item = { ...draft, name: draft.name.trim(), role: `${cat.label} • ${mob.label}`, status: draft.status || 'HOME' };

    setForm((prev) => ({
      ...prev,
      members: draft.id ? prev.members.map((m) => (m.id === draft.id ? item : m)) : [...prev.members, { ...item, id: `M-${Date.now()}` }],
    }));
    setDraft(null);
  };

  // Returns true when everything was saved.
  const handleSaveProfile = async () => {
    if (!isHead) {
      Alert.alert('View only', 'Only the household head can change the household profile.');
      return false;
    }
    setSaving(true);
    try {
      await updateMyHousehold({
        sitio: form.sitio.trim(),
        landmark: form.landmark.trim(),
        emerg_contact_no: form.contact2.trim(),
        ...(form.homeLat != null ? { gps_lat: form.homeLat, gps_long: form.homeLng } : {}),
        members: form.members.map(memberToDb),
      });
      if (facadeAsset) await setMyHousePhoto(facadeAsset);
      await refresh();
      Alert.alert('Profile saved ✅', `Household updated.\n• Members: ${form.members.length}`);
      return true;
    } catch (e) {
      Alert.alert('Not saved', e.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => Alert.alert('Log Out?', 'Sign out of this phone?', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Log Out',
      style: 'destructive',
      onPress: async () => {
        setSaved(form); // nothing left to warn about
        await signOut();
        router.replace('/(auth)/login');
      },
    },
  ]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top Header */}
      <View style={styles.topHeader}>
        <View>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerTitle}>Household Profile</Text>
            {profile?.is_verified
              ? <View style={styles.badgeVerified}><Text style={styles.badgeVerifiedText}>✓ VERIFIED</Text></View>
              : (
                <TouchableOpacity
                  style={[styles.badgeVerified, { backgroundColor: '#FEF3C7' }]}
                  accessibilityRole="button"
                  onPress={() => Alert.alert(
      'Get verified at your barangay hall 🪪',
      'Bring a valid ID to your barangay hall. Until your account is verified:\n\n• You can still send an SOS at any time.\n• You can have 1 hazard report waiting to be checked (3 when verified).\n• Your "I see it too" does not raise a hazard\'s alarm level.',
                  )}
                >
                  <Text style={[styles.badgeVerifiedText, { color: '#B45309' }]}>NOT VERIFIED YET ⓘ</Text>
                </TouchableOpacity>
              )}
          </View>
          <Text style={styles.headerSub}>Brgy. {form.barangay}{form.sitio ? ` • ${form.sitio}` : ''}</Text>
        </View>
        <ChangePasscode isResident />
        <TouchableOpacity style={styles.btnLogout} onPress={handleLogout} activeOpacity={0.75}>
          <Text style={styles.btnLogoutText}>Log Out</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* 1. Residence & Contact Details */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>1. HOME & CONTACT</Text>
          <Text style={styles.fieldLabel}>HEAD OF HOUSEHOLD NAME</Text>
          <TextInput style={[styles.input, styles.inputLocked]} value={form.repName} editable={false} />

          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.fieldLabel}>PRIMARY CONTACT</Text>
              <TextInput style={[styles.input, styles.inputLocked]} value={form.contact} editable={false} />
            </View>
            <View style={styles.col}>
              <Text style={styles.fieldLabel}>EMERGENCY CONTACT NO.</Text>
              <TextInput style={styles.input} placeholder="Optional" value={form.contact2} onChangeText={(v) => setField('contact2', v)} keyboardType="phone-pad" />
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.fieldLabel}>BARANGAY</Text>
              <TextInput style={[styles.input, styles.inputLocked]} value={form.barangay} editable={false} />
            </View>
            <View style={styles.col}>
              <Text style={styles.fieldLabel}>SITIO / ZONE</Text>
              <TextInput style={styles.input} value={form.sitio} onChangeText={(v) => setField('sitio', v)} />
            </View>
          </View>

          {/* Home location */}
          <Text style={styles.fieldLabel}>HOME LOCATION</Text>
          <View style={styles.geoBox}>
            <View style={styles.col}>
              <Text style={styles.geoVal}>
                📍 {form.homeLat ? `${form.homeLat.toFixed(5)}, ${form.homeLng.toFixed(5)}` : 'Not set'}
              </Text>
              <Text style={styles.geoSub}>Update it if the pin is wrong or you moved.</Text>
            </View>
            <TouchableOpacity style={styles.btnCalibrate} onPress={handleRecalibrateLocation}>
              <Text style={styles.btnCalibrateText}>🔄 Update</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.btnUseLocation} onPress={() => setPickerOpen(true)}>
            <Text style={styles.btnUseLocationText}>📍 Use My Current Location</Text>
          </TouchableOpacity>

          {/* Landmark */}
          <Text style={styles.fieldLabel}>LANDMARK</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., Blue gate across Aling Nena Store"
            value={form.landmark}
            onChangeText={(v) => setField('landmark', v)}
          />

          {/* Facade Strip with Tap-To-View */}
          <Text style={[styles.fieldLabel, { marginTop: 6 }]}>PHOTO OF YOUR HOUSE</Text>
          <View style={styles.facadeBox}>
            <TouchableOpacity onPress={() => form.facadeUri && setShowPreview(true)} activeOpacity={0.8}>
              {form.facadeUri
                ? <Image source={{ uri: form.facadeUri }} style={styles.facadeImg} />
                : <View style={[styles.facadeImg, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F5F9' }]}><Text>🏠</Text></View>}
              <View style={styles.zoomPill}><Text style={styles.zoomText}>🔍 View</Text></View>
            </TouchableOpacity>

            <View style={styles.col}>
              <Text style={styles.facadeTitle}>Helps responders find your house</Text>
              <Text style={styles.facadeDesc}>Tap photo to preview in full screen.</Text>
              <View style={styles.row}>
                <TouchableOpacity style={styles.btnMedia} onPress={handleCamera}>
                  <Text style={styles.btnMediaText}>📷 Take Photo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btnMedia, styles.btnMediaAlt]} onPress={handleGallery}>
                  <Text style={styles.btnMediaAltText}>🖼️ From Gallery</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        {/* 2. Registered Members Roster */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>2. HOUSEHOLD ROSTER ({form.members.length} PEOPLE)</Text>
            <TouchableOpacity style={styles.btnAdd} onPress={() => setDraft({ name: '', relationship: '', category: 'child', mobility: 'ambulatory' })}>
              <Text style={styles.btnAddText}>+ Add Member</Text>
            </TouchableOpacity>
          </View>

          {form.members.map((m, idx) => (
            <View key={m.id} style={[styles.memberRow, idx !== form.members.length - 1 && styles.borderBottom]}>
              <View style={styles.col}>
                <Text style={styles.memberName}>{m.name}</Text>
                <Text style={styles.memberRole}>
                  {[m.relationship,
                    RESIDENT_CATEGORIES.find((c) => c.id === m.category)?.label,
                    RESIDENT_MOBILITIES.find((x) => x.id === m.mobility)?.label].filter(Boolean).join(' • ')}
                </Text>
              </View>
              <View style={styles.row}>
                <TouchableOpacity style={styles.btnAction} onPress={() => setDraft({ ...m })}>
                  <Text style={styles.btnEditText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btnAction, styles.btnRemove]} onPress={() => setForm((p) => ({ ...p, members: p.members.filter((x) => x.id !== m.id) }))}>
                  <Text style={styles.btnRemoveText}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        {/* Dynamic Save Button */}
        <TouchableOpacity style={[styles.btnSave, (!isModified || saving) && styles.btnDisabled]} disabled={!isModified || saving} onPress={handleSaveProfile} activeOpacity={0.85}>
          {saving ? <ActivityIndicator color="#FFF" /> : (
            <Text style={[styles.btnSaveText, !isModified && styles.btnDisabledText]}>
              {isModified ? 'Save Profile Updates' : '✓ All Changes Saved'}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* Full-Screen Image Preview Modal */}
      <HomeLocationPicker
        visible={pickerOpen}
        fallback={form.homeLat != null ? { lat: form.homeLat, lng: form.homeLng } : null}
        saving={savingPin}
        onCancel={() => setPickerOpen(false)}
        onConfirm={handleSavePin}
      />

      <Modal visible={showPreview} transparent animationType="fade">
        <View style={styles.fullscreenBg}>
          <View style={styles.fullscreenHeader}>
            <Text style={styles.fullscreenTitle}>Your house</Text>
            <TouchableOpacity style={styles.btnClosePreview} onPress={() => setShowPreview(false)}>
              <Text style={styles.btnClosePreviewText}>✕ Close</Text>
            </TouchableOpacity>
          </View>
          <Image source={{ uri: form.facadeUri }} style={styles.fullscreenImg} resizeMode="contain" />
        </View>
      </Modal>

      {/* Add / Edit Member Modal Dialog */}
      <Modal visible={Boolean(draft)} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.dialog}>
            <View style={styles.rowBetween}>
              <Text style={styles.dialogTitle}>{draft?.id ? '✏️ Edit Family Member' : '➕ Add Family Member'}</Text>
              <TouchableOpacity onPress={() => setDraft(null)}><Text style={styles.dialogClose}>✕</Text></TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>FULL NAME</Text>
            <TextInput style={styles.input} placeholder="e.g., Carlo Santos" value={draft?.name || ''} onChangeText={(v) => setDraft((p) => ({ ...p, name: v }))} />

            <Text style={styles.fieldLabel}>RELATIONSHIP TO HEAD</Text>
            <TextInput style={styles.input} placeholder="e.g., Son" value={draft?.relationship || ''} onChangeText={(v) => setDraft((p) => ({ ...p, relationship: v }))} />

            <Text style={styles.fieldLabel}>STEP 1: AGE / PRIORITY GROUP</Text>
            <View style={styles.chipGrid}>
              {RESIDENT_CATEGORIES.map((c) => (
                <TouchableOpacity key={c.id} style={[styles.chip, draft?.category === c.id && styles.chipActive]} onPress={() => setDraft((p) => ({ ...p, category: c.id }))}>
                  <Text style={[styles.chipText, draft?.category === c.id && styles.chipTextActive]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 8 }]}>STEP 2: MOBILITY & DISABILITY (PWD)</Text>
            <View style={styles.chipGrid}>
              {RESIDENT_MOBILITIES.map((m) => (
                <TouchableOpacity key={m.id} style={[styles.chip, draft?.mobility === m.id && styles.chipMobActive]} onPress={() => setDraft((p) => ({ ...p, mobility: m.id }))}>
                  <Text style={[styles.chipText, draft?.mobility === m.id && styles.chipTextActive]}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={[styles.row, { marginTop: 12 }]}>
              <TouchableOpacity style={styles.btnModalCancel} onPress={() => setDraft(null)}>
                <Text style={styles.btnModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnModalSave} onPress={handleSaveDraft}>
                <Text style={styles.btnModalSaveText}>{draft?.id ? 'Apply Edit' : 'Add to Roster'}</Text>
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
  col: { flex: 1 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },

  topHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#FFF', borderBottomWidth: 1, borderColor: '#E2E8F0' },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: FONT_SIZES.title, fontWeight: FONT_WEIGHTS.black, color: '#0F172A' },
  headerSub: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#64748B', marginTop: 2 },
  badgeVerified: { backgroundColor: '#DCFCE7', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  badgeVerifiedText: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.black, color: '#15803D' },
  btnLogout: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  btnLogoutText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#DC2626' },

  content: { padding: 14, gap: 12, paddingBottom: 24 },

  card: { backgroundColor: '#FFF', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', elevation: 1 },
  sectionTitle: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.black, color: '#1E293B', letterSpacing: 0.3 },
  fieldLabel: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#475569', marginBottom: 4, marginTop: 6 },
  input: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: FONT_SIZES.body, color: '#0F172A', fontWeight: FONT_WEIGHTS.medium },
  inputLocked: { backgroundColor: '#F1F5F9', color: '#64748B' },

  /* Geotag box */
  geoBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE', borderRadius: 8, padding: 10, marginTop: 4, marginBottom: 8 },
  geoVal: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.extraBold, color: '#1E3A8A' },
  geoSub: { fontSize: FONT_SIZES.tiny, color: '#64748B', marginTop: 2 },
  btnUseLocation: { backgroundColor: '#1E3A8A', borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginBottom: 10 },
  btnUseLocationText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
  btnCalibrate: { backgroundColor: '#1E3A8A', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 6 },
  btnCalibrateText: { color: '#FFF', fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold },

  facadeBox: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: '#F8FAFC', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', marginTop: 4 },
  facadeImg: { width: 72, height: 72, borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1' },
  zoomPill: { position: 'absolute', bottom: 3, left: 3, right: 3, backgroundColor: 'rgba(15,23,42,0.75)', borderRadius: 4, paddingVertical: 2, alignItems: 'center' },
  zoomText: { color: '#FFF', fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold },
  facadeTitle: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.extraBold, color: '#0F172A' },
  facadeDesc: { fontSize: FONT_SIZES.tiny, color: '#64748B', marginVertical: 3 },
  btnMedia: { backgroundColor: '#1E3A8A', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6 },
  btnMediaAlt: { backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1' },
  btnMediaText: { color: '#FFF', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold },
  btnMediaAltText: { color: '#1E3A8A', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold },

  btnAdd: { backgroundColor: '#1E3A8A', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  btnAddText: { color: '#FFF', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold },

  memberRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  borderBottom: { borderBottomWidth: 1, borderColor: '#F1F5F9' },
  memberName: { fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.extraBold, color: '#0F172A' },
  memberRole: { fontSize: FONT_SIZES.caption, color: '#64748B', marginTop: 2, fontWeight: FONT_WEIGHTS.medium },
  btnAction: { backgroundColor: '#F1F5F9', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6 },
  btnRemove: { backgroundColor: '#FEF2F2' },
  btnEditText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#1E3A8A' },
  btnRemoveText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#DC2626' },

  btnSave: { backgroundColor: '#16A34A', paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
  btnSaveText: { color: '#FFF', fontWeight: FONT_WEIGHTS.black, fontSize: FONT_SIZES.body },
  btnDisabled: { backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  btnDisabledText: { color: '#94A3B8' },

  fullscreenBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', padding: 14 },
  fullscreenHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingHorizontal: 8 },
  fullscreenTitle: { color: '#FFF', fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.extraBold },
  btnClosePreview: { backgroundColor: 'rgba(255,255,255,0.2)', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  btnClosePreviewText: { color: '#FFF', fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.extraBold },
  fullscreenImg: { width: '100%', height: '80%' },

  modalBg: { flex: 1, backgroundColor: 'rgba(15,23,42,0.65)', justifyContent: 'center', padding: 18 },
  dialog: { backgroundColor: '#FFF', borderRadius: 14, padding: 16 },
  dialogTitle: { fontSize: FONT_SIZES.subtitle, fontWeight: FONT_WEIGHTS.black, color: '#1E3A8A' },
  dialogClose: { fontSize: FONT_SIZES.subtitle, fontWeight: FONT_WEIGHTS.black, color: '#64748B' },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 },
  chip: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: 6, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1' },
  chipActive: { backgroundColor: '#DBEAFE', borderColor: '#1E3A8A' },
  chipMobActive: { backgroundColor: '#DCFCE7', borderColor: '#16A34A' },
  chipText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#475569' },
  chipTextActive: { color: '#1E3A8A', fontWeight: FONT_WEIGHTS.black },
  btnModalCancel: { flex: 1, backgroundColor: '#F1F5F9', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  btnModalCancelText: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.extraBold, color: '#64748B' },
  btnModalSave: { flex: 2, backgroundColor: '#1E3A8A', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  btnModalSaveText: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.black, color: '#FFF' },
});