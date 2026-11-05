import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Pressable, ScrollView, Alert, Image, Modal, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { isContactRegistered, listBarangays, listSitios, normalizeContact, registerResident } from '../../services/api';
import { useSession } from '../../components/SessionProvider';
import HomePinMap, { CORDOVA_CENTER } from '../../components/HomePinMap';
import {
  ID_TYPES,
  RESIDENT_CATEGORIES,
  RESIDENT_MOBILITIES,
  HOUSE_TYPES,
} from '../../constants/mockData';
import { FONT_SIZES, FONT_WEIGHTS } from '../../constants/typography';
import { calculateVPI, getVPIPriority, determineRequiredGear } from '../../utils/vpi';

export const TENURE_TYPES = [
  { id: 'owner', label: '🏡 Homeowner' },
  { id: 'renter', label: '🏢 Tenant / Renter' },
  { id: 'boarder', label: '🛏️ Boarder / Bedspacer' },
];

export const FLOOR_LEVELS = [
  { id: 'ground', label: 'Ground Floor / 1-Storey' },
  { id: 'floor2', label: '2nd Floor' },
  { id: 'floor3', label: '3rd Floor or Higher' },
];

// Mobile number box: digits only, 11 digits (09XXXXXXXXX) or +63 and 10 digits.
export function cleanPhone(text) {
  const plus = text.trim().startsWith('+');
  const digits = text.replace(/\D/g, '');
  return plus ? `+${digits.slice(0, 12)}` : digits.slice(0, 11);
}

// A box that shows the chosen option and opens a list when tapped.
function Dropdown({ options, value, onChange, placeholder = 'Choose one' }) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.id === value);
  return (
    <View style={styles.ddWrap}>
      <TouchableOpacity style={styles.ddTrigger} onPress={() => setOpen((o) => !o)} activeOpacity={0.75}>
        <Text style={[styles.ddValue, !chosen && styles.ddPlaceholder]}>{chosen ? chosen.label : placeholder}</Text>
        <Text style={styles.dropdownArrow}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {open && options.map((o) => (
        <TouchableOpacity key={o.id} style={[styles.ddOption, o.id === value && styles.ddOptionActive]}
          onPress={() => { onChange(o.id); setOpen(false); }}>
          <Text style={[styles.ddOptionText, o.id === value && styles.ddOptionTextActive]}>{o.id === value ? '✓ ' : ''}{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// TEMPORARY: true lets Next skip the checks so every step can be previewed.
// "Send registration" still checks everything. Set back to false when done.
const ALLOW_BLANKS_FOR_PREVIEW = false;

const STEPS = ['About you', 'Your home', 'Household', 'ID check', 'PIN & review'];

export default function RegisterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refresh } = useSession();

  // 1. Head of Household
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const name = [firstName, lastName].filter((x) => x.trim()).join(' ');
  const [contact, setContact] = useState('');
  const [sex, setSex] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [emergName, setEmergName] = useState('');
  const [emergContact, setEmergContact] = useState('');
  const [barangays, setBarangays] = useState([]);
  const [barangay, setBarangay] = useState(null);
  const [barangayModalVisible, setBarangayModalVisible] = useState(false);
  const [sitio, setSitio] = useState('');
  const [sitios, setSitios] = useState([]);
  const [sitioModalVisible, setSitioModalVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [headCategory, setHeadCategory] = useState(RESIDENT_CATEGORIES[0].id);
  const [headMobility, setHeadMobility] = useState(RESIDENT_MOBILITIES[0].id);
  const [homeCoords, setHomeCoords] = useState(null);
  const [pinOpen, setPinOpen] = useState(false); // full-screen "pin my home" map
  const [pinCenter, setPinCenter] = useState(null); // where that map should move to
  const [pinDraft, setPinDraft] = useState(null); // the spot under the pin right now

  // Residential Tenure & Floor Level (Apartment / Renters)
  const [tenure, setTenure] = useState(TENURE_TYPES[0].id);
  const [floorLevel, setFloorLevel] = useState(FLOOR_LEVELS[0].id);
  const [unitNo, setUnitNo] = useState('');

  // 2. Identity Verification
  const [selectedId, setSelectedId] = useState(ID_TYPES[0]);
  const [idModalVisible, setIdModalVisible] = useState(false);
  const [idNumber, setIdNumber] = useState('');
  const [idImage, setIdImage] = useState(null);
  const idImageUri = idImage?.uri;

  // 3. Dynamic Household Members Roster
  const [members, setMembers] = useState([]);

  // 4. Structure & Micro-Navigation
  const [houseType, setHouseType] = useState(HOUSE_TYPES[2].id);
  const [landmark, setLandmark] = useState('');
  const [facadeImage, setFacadeImage] = useState(null);
  const facadeImageUri = facadeImage?.uri;
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    listBarangays().then(setBarangays).catch(() => setBarangays([]));
  }, []);

  // The barangay's official sitio list (kept by barangay staff on the web).
  useEffect(() => {
    setSitio('');
    setSitios([]);
    if (barangay) listSitios(barangay.barangay_id).then(setSitios);
  }, [barangay]);

  // Reads the phone's GPS. Returns { lat, lng } or null.
  const readGps = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Location is off', 'Allow location access, or move the pin on the map yourself.');
      return null;
    }
    try {
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      return { lat: fix.coords.latitude, lng: fix.coords.longitude };
    } catch {
      Alert.alert('No GPS signal', 'Try again outdoors, or move the pin on the map yourself.');
      return null;
    }
  };

  const takeGps = async () => {
    const spot = await readGps();
    if (spot) setHomeCoords(spot);
  };

  const openPinMap = () => {
    const start = homeCoords
      || (barangay?.center_lat ? { lat: Number(barangay.center_lat), lng: Number(barangay.center_lng) } : CORDOVA_CENTER);
    setPinCenter({ ...start });
    setPinDraft(start);
    setPinOpen(true);
  };

  const pinMapGps = async () => {
    const spot = await readGps();
    if (spot) { setPinCenter(spot); setPinDraft(spot); }
  };

  const handleAddMember = () => {
    setMembers((prev) => [
      ...prev,
      { id: `M-${Date.now()}`, name: '', relationship: '', category: 'adult', mobility: 'ambulatory' },
    ]);
  };

  const handleUpdateMember = (id, field, value) => {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, [field]: value } : m)));
  };

  const handleRemoveMember = (id) => {
    setMembers((prev) => prev.filter((m) => m.id !== id));
  };

  const handleCamera = async (setAsset = setFacadeImage) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') return Alert.alert('Permission Denied', 'Camera access is required.');

    const res = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.6 });
    if (!res.canceled && res.assets?.[0]?.uri) {
      setAsset(res.assets[0]);
    }
  };

  const handleGallery = async (setAsset = setFacadeImage) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return Alert.alert('Permission Denied', 'Photo library access is required.');

    const res = await ImagePicker.launchImageLibraryAsync({ allowsEditing: false, quality: 0.6 });
    if (!res.canceled && res.assets?.[0]?.uri) {
      setAsset(res.assets[0]);
    }
  };

  const handleIdPhoto = () => {
    Alert.alert('Photo of Valid ID 🪪', 'Make sure the name and ID number are readable.', [
      { text: 'Cancel', style: 'cancel' },
      { text: '📷 Take Photo', onPress: () => handleCamera(setIdImage) },
      { text: '🖼️ From Gallery', onPress: () => handleGallery(setIdImage) },
    ]);
  };

  const allRoster = [{ name: name || 'Head', category: headCategory, mobility: headMobility }, ...members];
  const totalHeadcount = allRoster.length;
  const semiCount = allRoster.filter((m) => m.mobility === 'semi').length;
  const nonAmbulatoryCount = allRoster.filter((m) => m.mobility === 'non' || m.mobility === 'wheelchair').length;
  const childrenCount = allRoster.filter((m) => m.category === 'child').length;
  const seniorsCount = allRoster.filter((m) => m.category === 'senior').length;
  const pregnantCount = allRoster.filter((m) => m.category === 'pregnant').length;

  // What each step still needs before Next.
  const missingFor = (i) => {
    const missing = [];
    if (i === 0) {
      if (!firstName.trim() || !lastName.trim()) missing.push('your first and last name');
      if (!/^09\d{9}$/.test(normalizeContact(contact))) missing.push('a mobile number like 09171234567 or +639171234567');
      if (!sex) missing.push('sex');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || Number.isNaN(Date.parse(birthdate))) missing.push('birthdate as YYYY-MM-DD');
      if (!emergName.trim() || !/^09\d{9}$/.test(normalizeContact(emergContact))) missing.push('an emergency contact with a full mobile number');
    }
    if (i === 1 && !barangay) missing.push('your barangay');
    if (i === 2 && members.some((m) => !m.name.trim())) missing.push('a name for every member (or remove the empty ones)');
    if (i === 3 && (!idNumber.trim() || !idImage)) missing.push('your ID number and a photo of the ID');
    if (i === 4) {
      if (!/^\d{6}$/.test(pin)) missing.push('a 6-digit PIN');
      else if (pin !== pinConfirm) missing.push('the same PIN twice');
    }
    return missing;
  };

  const [checkingContact, setCheckingContact] = useState(false);
  const goNext = async () => {
    if (ALLOW_BLANKS_FOR_PREVIEW) return setStep((n) => Math.min(n + 1, STEPS.length - 1));
    const missing = missingFor(step);
    if (missing.length) return Alert.alert('Please complete this step', `Add ${missing.join(', ')}.`);
    if (step === 0) {
      setCheckingContact(true);
      const taken = await isContactRegistered(contact);
      setCheckingContact(false);
      if (taken) {
        return Alert.alert('Number already registered', `${normalizeContact(contact)} already has an account. Sign in with it instead, or use a different number.`);
      }
    }
    setStep((n) => Math.min(n + 1, STEPS.length - 1));
  };

  const handleSubmit = async () => {
    for (let i = 0; i < STEPS.length; i += 1) {
      const missing = missingFor(i);
      if (missing.length) {
        setStep(i);
        return Alert.alert('Please complete this step', `Add ${missing.join(', ')}.`);
      }
    }
    const score = calculateVPI({ semiCount, nonAmbulatoryCount, childrenCount, seniorsCount, pregnantCount, houseType });
    const priority = getVPIPriority(score);
    const gear = determineRequiredGear({ nonAmbulatoryCount, semiCount, pregnantCount, childrenCount });

    setSubmitting(true);
    try {
      const { warnings } = await registerResident({
        pin, f_name: firstName.trim(), m_name: middleName.trim(), l_name: lastName.trim(),
        contact_no: contact, sex, birthdate, mobility: headMobility, category: headCategory,
        emerg_contact_name: emergName.trim(), emerg_contact_no: emergContact,
        barangay_id: barangay.barangay_id, sitio: sitio.trim(), landmark: landmark.trim(),
        gps_lat: homeCoords?.lat, gps_long: homeCoords?.lng,
        house_type: houseType, tenure, floor_level: floorLevel, unit_no: unitNo.trim(),
        members, id_code: selectedId.id, id_number: idNumber.trim(), id_image: idImage, facade_image: facadeImage,
      });
      await refresh();
      Alert.alert(
        'Registration sent 🎉',
        `${name}, Brgy. ${barangay.barangay_name}${sitio ? `, ${sitio}` : ''}\n• Household: ${totalHeadcount} ${totalHeadcount === 1 ? 'person' : 'people'}\n• Priority score (VPI): ${score}/100 (${priority})\n• Rescue equipment: ${gear}\n\nYour barangay will check your ID. Sign in next time with ${normalizeContact(contact)} and your PIN.${warnings.length ? `\n\n⚠️ ${warnings.join('\n')}` : ''}`,
        [{ text: 'Open my household', onPress: () => router.replace('/(resident)') }]
      );
    } catch (e) {
      Alert.alert('Registration Failed', e.message);
    } finally {
      setSubmitting(false);
    }
  };


  // One row of choice buttons.
  const Choices = ({ options, value, onChange, grid = false, activeStyle = styles.chipActive }) => (
    <View style={grid ? styles.grid2Col : styles.row}>
      {options.map((o) => (
        <TouchableOpacity key={o.id} style={[grid ? styles.gridChip : styles.pill, value === o.id && activeStyle]} onPress={() => onChange(o.id)}>
          <Text style={[grid ? styles.chipText : styles.pillText, value === o.id && styles.chipTextActive]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
  const Label = ({ children, hint }) => (
    <>
      <Text style={styles.label}>{children}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </>
  );

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {/* Progress */}
      <View style={styles.progressWrap}>
        <Text style={styles.progressText}>Step {step + 1} of {STEPS.length} · {STEPS[step]}</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((step + 1) / STEPS.length) * 100}%` }]} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {step === 0 && <>
          <Text style={styles.stepTitle}>About you</Text>
          <Text style={styles.stepSub}>You will be the household's contact person.</Text>
          <Label>First name</Label>
          <TextInput style={styles.input} placeholder="e.g. Maria" value={firstName} onChangeText={setFirstName} />
          <Label>Middle name (optional)</Label>
          <TextInput style={styles.input} value={middleName} onChangeText={setMiddleName} />
          <Label>Last name</Label>
          <TextInput style={styles.input} placeholder="e.g. Santos" value={lastName} onChangeText={setLastName} />
          <Label hint="You will sign in with this number.">Mobile number</Label>
          <TextInput style={styles.input} placeholder="09XXXXXXXXX" keyboardType="phone-pad" value={contact} onChangeText={(t) => setContact(cleanPhone(t))} />
          <Label>Sex</Label>
          <Choices options={[{ id: 'female', label: 'Female' }, { id: 'male', label: 'Male' }]} value={sex} onChange={setSex} />
          <Label>Birthdate</Label>
          <TextInput style={styles.input} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} value={birthdate} onChangeText={setBirthdate} />
          <Label>Which describes you?</Label>
          <Dropdown options={RESIDENT_CATEGORIES} value={headCategory} onChange={setHeadCategory} />
          <Label>Can you walk on your own?</Label>
          <Dropdown options={RESIDENT_MOBILITIES} value={headMobility} onChange={setHeadMobility} />
          <Label hint="Someone we can call if we cannot reach you.">Emergency contact</Label>
          <TextInput style={styles.input} placeholder="Name" value={emergName} onChangeText={setEmergName} />
          <TextInput style={styles.input} placeholder="Mobile number (09XXXXXXXXX)" keyboardType="phone-pad" value={emergContact} onChangeText={(t) => setEmergContact(cleanPhone(t))} />
        </>}

        {step === 1 && <>
          <Text style={styles.stepTitle}>Your home</Text>
          <Text style={styles.stepSub}>This helps rescuers find your house.</Text>
          <Label>Barangay</Label>
          <TouchableOpacity style={styles.dropdownTrigger} onPress={() => setBarangayModalVisible(true)}>
            <View style={styles.col}>
              <Text style={styles.dropdownName}>{barangay ? barangay.barangay_name : 'Choose your barangay'}</Text>
              <Text style={styles.dropdownDesc}>Cordova, Cebu</Text>
            </View>
            <Text style={styles.dropdownArrow}>▼</Text>
          </TouchableOpacity>
          <Label>Sitio</Label>
          <TouchableOpacity
            style={[styles.dropdownTrigger, !barangay && { opacity: 0.5 }]}
            disabled={!barangay}
            onPress={() => setSitioModalVisible(true)}
          >
            <View style={styles.col}>
              <Text style={styles.dropdownName}>{sitio || (barangay ? 'Choose your sitio' : 'Choose a barangay first')}</Text>
              {barangay && sitios.length === 0 && <Text style={styles.dropdownDesc}>Your barangay has not listed its sitios yet. You can skip this.</Text>}
            </View>
            <Text style={styles.dropdownArrow}>▼</Text>
          </TouchableOpacity>
          <Label hint="Something a rescuer can see from the street.">Landmark (optional)</Label>
          <TextInput style={styles.input} placeholder="e.g. Blue gate across Aling Nena Store" value={landmark} onChangeText={setLandmark} />

          <Label>What is your house made of?</Label>
          <Dropdown options={HOUSE_TYPES} value={houseType} onChange={setHouseType} />
          <Label>Do you own or rent?</Label>
          <Dropdown options={TENURE_TYPES} value={tenure} onChange={setTenure} />
          {(tenure === 'renter' || tenure === 'boarder') && (
            <TextInput style={[styles.input, { marginTop: 8 }]} placeholder="Room / unit no. (e.g. Unit 2B)" value={unitNo} onChangeText={setUnitNo} />
          )}
          <Label>Which floor do you live on?</Label>
          <Dropdown options={FLOOR_LEVELS} value={floorLevel} onChange={setFloorLevel} />

          <Label hint="Rescuers use this pin to find your house.">Home location</Label>
          {homeCoords ? (
            <TouchableOpacity activeOpacity={0.85} onPress={openPinMap}>
              <HomePinMap center={homeCoords} />
            </TouchableOpacity>
          ) : (
            <View style={styles.pinEmpty}><Text style={styles.hint}>No pin yet. Use your GPS at home, or pin it on the map.</Text></View>
          )}
          <View style={styles.pinButtons}>
            <TouchableOpacity style={[styles.btnMedia, styles.pinBtn]} onPress={takeGps}>
              <Text style={styles.btnMediaText}>📡 Use my GPS</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btnMedia, styles.btnMediaAlt, styles.pinBtn]} onPress={openPinMap}>
              <Text style={styles.btnMediaAltText}>🗺️ {homeCoords ? 'Move the pin' : 'Pin on map'}</Text>
            </TouchableOpacity>
          </View>

          <Label hint="Helps rescuers recognise your house.">Photo of your house (optional)</Label>
          <View style={styles.facadeBox}>
            {facadeImageUri ? (
              <TouchableOpacity onPress={() => setShowPreview(true)} activeOpacity={0.8}>
                <Image source={{ uri: facadeImageUri }} style={styles.facadeImg} />
                <View style={styles.zoomPill}><Text style={styles.zoomText}>🔍 View</Text></View>
              </TouchableOpacity>
            ) : (
              <View style={[styles.facadeImg, styles.facadePlaceholder]}><Text style={{ fontSize: 24 }}>🏠</Text></View>
            )}
            <View style={[styles.col, styles.rowWrap]}>
              <TouchableOpacity style={styles.btnMedia} onPress={() => handleCamera()}>
                <Text style={styles.btnMediaText}>📷 Take photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnMedia, styles.btnMediaAlt]} onPress={() => handleGallery()}>
                <Text style={styles.btnMediaAltText}>🖼️ Gallery</Text>
              </TouchableOpacity>
            </View>
          </View>
        </>}

        {step === 2 && <>
          <Text style={styles.stepTitle}>Who lives with you?</Text>
          <Text style={styles.stepSub}>Add everyone in your house so no one is missed during an evacuation. You are already counted.</Text>
          <View style={styles.summaryBar}>
            <Text style={styles.summaryText}>
              {totalHeadcount} {totalHeadcount === 1 ? 'person' : 'people'} · {childrenCount} child · {seniorsCount} senior · {pregnantCount} pregnant · {nonAmbulatoryCount} cannot walk
            </Text>
          </View>
          {members.map((member, index) => (
            <View key={member.id} style={styles.memberCard}>
              <View style={styles.memberTopRow}>
                <Text style={styles.memberIndex}>Person {index + 2}</Text>
                <TouchableOpacity onPress={() => handleRemoveMember(member.id)}>
                  <Text style={styles.btnRemove}>Remove</Text>
                </TouchableOpacity>
              </View>
              <TextInput style={styles.input} placeholder="Full name" value={member.name} onChangeText={(val) => handleUpdateMember(member.id, 'name', val)} />
              <TextInput style={styles.input} placeholder="Relationship to you (e.g. Daughter)" value={member.relationship || ''} onChangeText={(val) => handleUpdateMember(member.id, 'relationship', val)} />
              <Label>Which describes them?</Label>
              <Dropdown options={RESIDENT_CATEGORIES} value={member.category} onChange={(v) => handleUpdateMember(member.id, 'category', v)} />
              <Label>Can they walk on their own?</Label>
              <Dropdown options={RESIDENT_MOBILITIES} value={member.mobility} onChange={(v) => handleUpdateMember(member.id, 'mobility', v)} />
            </View>
          ))}
          <TouchableOpacity style={styles.btnAddMember} onPress={handleAddMember}>
            <Text style={styles.btnAddMemberText}>+ Add a person</Text>
          </TouchableOpacity>
        </>}

        {step === 3 && <>
          <Text style={styles.stepTitle}>ID check</Text>
          <Text style={styles.stepSub}>Your barangay checks this before your account is verified.</Text>
          <Label>Type of ID</Label>
          <TouchableOpacity style={styles.dropdownTrigger} onPress={() => setIdModalVisible(true)}>
            <View style={styles.col}>
              <Text style={styles.dropdownName}>{selectedId.name}</Text>
              <Text style={styles.dropdownDesc}>{selectedId.desc}</Text>
            </View>
            <Text style={styles.dropdownArrow}>▼</Text>
          </TouchableOpacity>
          <Label>ID number</Label>
          <TextInput style={styles.input} value={idNumber} onChangeText={setIdNumber} />
          <Label hint="Make sure the name and number are readable.">Photo of the ID</Label>
          <TouchableOpacity style={[styles.btnUpload, idImageUri && styles.btnDone]} onPress={handleIdPhoto}>
            <Text style={styles.btnUploadText}>{idImageUri ? '✅ Photo added. Tap to change' : '🪪 Add a photo of your ID'}</Text>
          </TouchableOpacity>
          {idImageUri && <Image source={{ uri: idImageUri }} style={styles.previewImg} />}
        </>}

        {step === 4 && <>
          <Text style={styles.stepTitle}>Make a PIN</Text>
          <Text style={styles.stepSub}>You will sign in with {normalizeContact(contact) || 'your mobile number'} and this PIN.</Text>
          <Label>6-digit PIN</Label>
          <TextInput style={styles.input} keyboardType="number-pad" secureTextEntry maxLength={6} value={pin} onChangeText={setPin} />
          <Label>Type it again</Label>
          <TextInput style={styles.input} keyboardType="number-pad" secureTextEntry maxLength={6} value={pinConfirm} onChangeText={setPinConfirm} />

          <View style={styles.reviewCard}>
            <Text style={styles.reviewTitle}>Check before sending</Text>
            <Text style={styles.reviewLine}>👤 {name || '—'} · {normalizeContact(contact) || '—'}</Text>
            <Text style={styles.reviewLine}>🏠 {barangay ? `Brgy. ${barangay.barangay_name}` : '—'}{sitio ? `, ${sitio}` : ''}{landmark ? ` · ${landmark}` : ''}</Text>
            <Text style={styles.reviewLine}>👨‍👩‍👧 {totalHeadcount} {totalHeadcount === 1 ? 'person' : 'people'} in the household</Text>
            <Text style={styles.reviewLine}>📍 {homeCoords ? 'Home location saved' : 'No home location yet'} · 🪪 {idImageUri ? 'ID photo added' : 'No ID photo'}</Text>
            <Text style={styles.reviewLine}>
              ⚠️ Priority score (VPI): {calculateVPI({ semiCount, nonAmbulatoryCount, childrenCount, seniorsCount, pregnantCount, houseType })}/100
            </Text>
            <Text style={styles.hint}>Tap Back to change anything.</Text>
          </View>
        </>}
      </ScrollView>

      {/* Back / Next */}
      <View style={styles.footer}>
        {step > 0 && (
          <TouchableOpacity style={[styles.btnFooter, styles.btnBack]} onPress={() => setStep((n) => n - 1)} disabled={submitting}>
            <Text style={styles.btnBackText}>Back</Text>
          </TouchableOpacity>
        )}
        {step < STEPS.length - 1 ? (
          <TouchableOpacity style={[styles.btnFooter, styles.btnNext, checkingContact && { opacity: 0.7 }]} onPress={goNext} disabled={checkingContact}>
            <Text style={styles.btnNextText}>{checkingContact ? 'Checking number…' : 'Next'}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.btnFooter, styles.btnSubmit, submitting && { opacity: 0.7 }]} onPress={handleSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnNextText}>Send registration</Text>}
          </TouchableOpacity>
        )}
      </View>

      {/* Pin my home: drag the map so the pin sits on the house */}
      <Modal visible={pinOpen} animationType="slide" onRequestClose={() => setPinOpen(false)}>
        <View style={[styles.pinScreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <Text style={styles.pinTitle}>Move the map so the pin is on your house</Text>
          <HomePinMap interactive center={pinCenter} onMove={setPinDraft} style={styles.pinMapFull} />
          <Text style={styles.pinCoords}>{pinDraft ? `${pinDraft.lat.toFixed(5)}, ${pinDraft.lng.toFixed(5)}` : ''}</Text>
          <View style={styles.pinButtons}>
            <TouchableOpacity style={[styles.btnMedia, styles.btnMediaAlt, styles.pinBtn]} onPress={pinMapGps}>
              <Text style={styles.btnMediaAltText}>📡 Go to my GPS</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btnMedia, styles.btnMediaAlt, styles.pinBtn]} onPress={() => setPinOpen(false)}>
              <Text style={styles.btnMediaAltText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btnMedia, styles.pinBtn]} onPress={() => { setHomeCoords(pinDraft); setPinOpen(false); }}>
              <Text style={styles.btnMediaText}>Save this spot</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Sitio Selection Modal */}
      <Modal visible={sitioModalVisible} transparent animationType="fade" onRequestClose={() => setSitioModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSitioModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Choose your sitio</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {sitios.length === 0 && <Text style={styles.optionDesc}>Your barangay has not listed its sitios yet. You can skip this; add a landmark instead.</Text>}
              {sitios.map((s) => (
                <TouchableOpacity key={s.sitio_id} style={styles.optionRow} onPress={() => { setSitio(s.sitio_name); setSitioModalVisible(false); }}>
                  <Text style={styles.optionTitle}>{s.sitio_name}</Text>
                </TouchableOpacity>
              ))}
              {sitio ? (
                <TouchableOpacity style={styles.optionRow} onPress={() => { setSitio(''); setSitioModalVisible(false); }}>
                  <Text style={styles.optionDesc}>Clear sitio</Text>
                </TouchableOpacity>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Full-Screen Image Preview Modal */}
      <Modal visible={showPreview} transparent animationType="fade">
        <View style={styles.fullscreenBg}>
          <View style={styles.fullscreenHeader}>
            <Text style={styles.fullscreenTitle}>Photo of your house</Text>
            <TouchableOpacity style={styles.btnClosePreview} onPress={() => setShowPreview(false)}>
              <Text style={styles.btnClosePreviewText}>✕ Close</Text>
            </TouchableOpacity>
          </View>
          {facadeImageUri && <Image source={{ uri: facadeImageUri }} style={styles.fullscreenImg} resizeMode="contain" />}
        </View>
      </Modal>

      {/* Barangay Selection Modal */}
      <Modal visible={barangayModalVisible} transparent animationType="fade" onRequestClose={() => setBarangayModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setBarangayModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Choose your barangay</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {barangays.length === 0 && <Text style={styles.optionDesc}>Loading barangays… check your connection.</Text>}
              {barangays.map((b) => (
                <TouchableOpacity key={b.barangay_id} style={styles.optionRow} onPress={() => { setBarangay(b); setBarangayModalVisible(false); }}>
                  <Text style={styles.optionTitle}>{b.barangay_name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ID Selection Modal */}
      <Modal visible={idModalVisible} transparent animationType="fade" onRequestClose={() => setIdModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setIdModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Type of ID</Text>
            {ID_TYPES.map((item) => (
              <TouchableOpacity key={item.id} style={styles.optionRow} onPress={() => { setSelectedId(item); setIdModalVisible(false); }}>
                <Text style={styles.optionTitle}>{item.name}</Text>
                <Text style={styles.optionDesc}>{item.desc}</Text>
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  progressWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, backgroundColor: '#FFF', borderBottomWidth: 1, borderColor: '#E2E8F0' },
  progressText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#1E3A8A', marginBottom: 6 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#E2E8F0', overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: '#1E3A8A' },
  stepTitle: { fontSize: FONT_SIZES.title, fontWeight: FONT_WEIGHTS.extraBold, color: '#0F172A' },
  stepSub: { fontSize: FONT_SIZES.body, color: '#475569', marginTop: 2, marginBottom: 8 },
  ddWrap: { marginBottom: 8, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, backgroundColor: '#FFF', overflow: 'hidden' },
  ddTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: 12 },
  ddValue: { flex: 1, fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.bold, color: '#0F172A' },
  ddPlaceholder: { color: '#94A3B8', fontWeight: FONT_WEIGHTS.medium },
  ddOption: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderTopWidth: 1, borderColor: '#E2E8F0' },
  ddOptionActive: { backgroundColor: '#EFF6FF' },
  ddOptionText: { fontSize: FONT_SIZES.body, color: '#334155' },
  ddOptionTextActive: { color: '#1E3A8A', fontWeight: FONT_WEIGHTS.black },
  label: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.bold, color: '#0F172A', marginTop: 12, marginBottom: 5 },
  hint: { fontSize: FONT_SIZES.caption, color: '#64748B', marginTop: -2, marginBottom: 6 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btnDone: { backgroundColor: '#F0FDF4', borderColor: '#16A34A', borderStyle: 'solid' },
  reviewCard: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, padding: 12, marginTop: 16, gap: 4 },
  reviewTitle: { fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.extraBold, color: '#0F172A', marginBottom: 4 },
  reviewLine: { fontSize: FONT_SIZES.body, color: '#1E293B' },
  footer: { flexDirection: 'row', gap: 10, padding: 12, backgroundColor: '#FFF', borderTopWidth: 1, borderColor: '#E2E8F0' },
  btnFooter: { flex: 1, minHeight: 50, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  btnBack: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CBD5E1' },
  btnBackText: { color: '#1E3A8A', fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.extraBold, textAlign: 'center' },
  btnNext: { backgroundColor: '#1E3A8A' },
  btnNextText: { color: '#FFF', fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.extraBold, textAlign: 'center' },
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  scrollContent: { padding: 16, paddingBottom: 32 },
  col: { flex: 1 },
  row: { flexDirection: 'row', gap: 8 },

  input: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: FONT_SIZES.body, color: '#0F172A', fontWeight: FONT_WEIGHTS.medium, marginBottom: 8 },



  dropdownTrigger: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 10, marginBottom: 8 },
  dropdownName: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.extraBold, color: '#0F172A' },
  dropdownDesc: { fontSize: FONT_SIZES.tiny, color: '#64748B' },
  dropdownArrow: { fontSize: FONT_SIZES.caption, color: '#1E3A8A', fontWeight: FONT_WEIGHTS.black },

  btnAddMember: { backgroundColor: '#1E3A8A', paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  btnAddMemberText: { color: '#FFF', fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.extraBold, textAlign: 'center' },

  summaryBar: { backgroundColor: '#F1F5F9', padding: 8, borderRadius: 6, marginBottom: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  summaryText: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#1E3A8A', textAlign: 'center' },

  memberCard: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, padding: 12, marginBottom: 10 },
  memberTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  memberIndex: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.black, color: '#1E3A8A' },
  btnRemove: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#DC2626' },

  grid2Col: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridChip: {
    width: '48.8%',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: '#1E3A8A', borderColor: '#1E3A8A' },
  chipText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#475569', textAlign: 'center' },
  chipTextActive: { color: '#FFF', fontWeight: FONT_WEIGHTS.extraBold },

  pill: { flex: 1, minHeight: 44, justifyContent: 'center', paddingVertical: 9, paddingHorizontal: 4, borderRadius: 8, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center' },
  pillText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#475569', textAlign: 'center' },

  btnUpload: { backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1', borderStyle: 'dashed', borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginVertical: 4 },
  btnUploadText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#1E3A8A' },
  previewImg: { width: '100%', height: 120, borderRadius: 8, marginVertical: 6 },

  facadeBox: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: '#F8FAFC', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', marginTop: 4 },
  facadeImg: { width: 72, height: 72, borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1' },
  facadePlaceholder: { backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  zoomPill: { position: 'absolute', bottom: 3, left: 3, right: 3, backgroundColor: 'rgba(15,23,42,0.75)', borderRadius: 4, paddingVertical: 2, alignItems: 'center' },
  zoomText: { color: '#FFF', fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold },
  btnMedia: { backgroundColor: '#1E3A8A', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6 },
  btnMediaAlt: { backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1' },
  btnMediaText: { color: '#FFF', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold },
  btnMediaAltText: { color: '#1E3A8A', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold },

  btnSubmit: { backgroundColor: '#16A34A' },

  fullscreenBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', padding: 14 },
  fullscreenHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingHorizontal: 8 },
  fullscreenTitle: { color: '#FFF', fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.extraBold },
  btnClosePreview: { backgroundColor: 'rgba(255,255,255,0.2)', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  btnClosePreviewText: { color: '#FFF', fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.extraBold },
  fullscreenImg: { width: '100%', height: '80%' },

  pinEmpty: { height: 70, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: '#CBD5E1', justifyContent: 'center', padding: 12, backgroundColor: '#F8FAFC' },
  pinButtons: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 4 },
  pinBtn: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  pinScreen: { flex: 1, backgroundColor: '#FFF', paddingHorizontal: 12 },
  pinTitle: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.bold, color: '#0F172A', marginVertical: 10, textAlign: 'center' },
  pinMapFull: { flex: 1, height: undefined },
  pinCoords: { textAlign: 'center', color: '#64748B', fontSize: FONT_SIZES.caption, marginTop: 6 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#FFF', borderRadius: 14, padding: 16 },
  modalTitle: { fontSize: FONT_SIZES.subtitle, fontWeight: FONT_WEIGHTS.extraBold, color: '#0F172A', marginBottom: 10 },
  optionRow: { paddingVertical: 9, borderBottomWidth: 1, borderColor: '#F1F5F9' },
  optionTitle: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.bold, color: '#1E293B' },
  optionDesc: { fontSize: FONT_SIZES.tiny, color: '#64748B' },
});