import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, Image, Modal, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { listBarangays, normalizeContact, registerResident } from '../../services/api';
import { useSession } from '../../components/SessionProvider';
import HomeLocationPicker from '../../components/HomeLocationPicker';
import BirthdatePicker from '../../components/BirthdatePicker';
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
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [headCategory, setHeadCategory] = useState(RESIDENT_CATEGORIES[0].id);
  const [headMobility, setHeadMobility] = useState(RESIDENT_MOBILITIES[0].id);
  const [homeCoords, setHomeCoords] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);

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

  // Inline field errors: key -> message shown in red under the field
  const [errors, setErrors] = useState({});
  const scrollRef = useRef(null);
  const fieldY = useRef({});
  const at = (key) => (e) => { fieldY.current[key] = e.nativeEvent.layout.y; };
  const clearErr = (...keys) => setErrors((prev) => {
    if (!keys.some((k) => prev[k])) return prev;
    const next = { ...prev };
    keys.forEach((k) => delete next[k]);
    return next;
  });
  const err = (key) => (errors[key] ? <Text style={styles.errorText}>{errors[key]}</Text> : null);
  const inp = (key) => [styles.input, errors[key] && styles.inputError];
  useEffect(() => { if (idImage) clearErr('idImage'); }, [idImage]);

  useEffect(() => {
    listBarangays().then(setBarangays).catch(() => setBarangays([]));
  }, []);

  const captureDeviceGps = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return Alert.alert('Permission Denied', 'Location access is needed to pin your home.');
    try {
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const liveFix = { lat: fix.coords.latitude, lng: fix.coords.longitude };
      setHomeCoords(liveFix);
      Alert.alert('Position Locked 📍', `Calibrated to:\n${liveFix.lat.toFixed(5)}, ${liveFix.lng.toFixed(5)}`);
    } catch {
      Alert.alert('No GPS Fix', 'Could not read your location. Try again outdoors, or use the barangay centre for now.');
    }
  };

  const handleLockHomeLocation = () => {
    const options = [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Capture Device GPS', onPress: captureDeviceGps },
    ];
    if (barangay?.center_lat) {
      options.splice(1, 0, {
        text: `Use ${barangay.barangay_name} Centre`,
        onPress: () => {
          const centroid = { lat: Number(barangay.center_lat), lng: Number(barangay.center_lng) };
          setHomeCoords(centroid);
          Alert.alert('Calibrated 📍', `Anchored to the ${barangay.barangay_name} centre. Recalibrate at home with GPS for a precise pin.`);
        },
      });
    }
    Alert.alert('Calibrate Home Coordinates 📍', 'Select coordinate calibration source for your household:', options);
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

  const handleSubmit = async () => {
    const next = {};
    if (!firstName.trim()) next.firstName = 'Enter your first name.';
    if (!lastName.trim()) next.lastName = 'Enter your last name.';
    if (!/^09\d{9}$/.test(normalizeContact(contact))) next.contact = 'Enter an 11-digit mobile number starting with 09, e.g. 09171234567.';
    if (!sex) next.sex = 'Choose Female or Male.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || Number.isNaN(Date.parse(birthdate))) next.birthdate = 'Choose your birthdate.';
    if (!barangay) next.barangay = 'Choose your barangay.';
    if (!emergName.trim()) next.emergName = 'Enter an emergency contact person.';
    if (!emergContact.trim()) next.emergContact = "Enter the emergency contact's number.";
    if (!idNumber.trim()) next.idNumber = 'Enter your ID number.';
    if (!idImage) next.idImage = 'Upload a photo of your ID.';
    members.forEach((m) => { if (!m.name.trim()) next[`member_${m.id}`] = "Enter this member's name, or remove them."; });
    if (!/^\d{6}$/.test(pin)) next.pin = 'PIN must be exactly 6 digits.';
    else if (pin !== pinConfirm) next.pinConfirm = "PINs don't match.";
    setErrors(next);
    const keys = Object.keys(next);
    if (keys.length) {
      const ys = keys.map((k) => fieldY.current[k]).filter((y) => typeof y === 'number');
      if (ys.length) scrollRef.current?.scrollTo({ y: Math.max(0, Math.min(...ys) - 40), animated: true });
      return;
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
        'Registration Submitted! 🎉',
        `Head: ${name} (${barangay.barangay_name})\n• Household: ${totalHeadcount} Souls\n• VPI Score: ${score} (${priority})\n• Extraction Gear: ${gear}\n\nYour ID is queued for barangay verification. Sign in next time with ${normalizeContact(contact)} and your PIN.${warnings.length ? `\n\n⚠️ ${warnings.join('\n')}` : ''}`,
        [{ text: 'Open Household Portal', onPress: () => router.replace('/(resident)') }]
      );
    } catch (e) {
      Alert.alert('Registration Failed', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* 1. Head of Household */}
        <Text style={styles.sectionHeader}>1. HEAD OF HOUSEHOLD REPRESENTATIVE</Text>
        <TextInput style={inp('firstName')} onLayout={at('firstName')} placeholder="First Name (e.g., Maria)" value={firstName} onChangeText={(v) => { setFirstName(v); clearErr('firstName'); }} />
        {err('firstName')}
        <TextInput style={styles.input} placeholder="Middle Name (optional)" value={middleName} onChangeText={setMiddleName} />
        <TextInput style={inp('lastName')} onLayout={at('lastName')} placeholder="Last Name (e.g., Santos)" value={lastName} onChangeText={(v) => { setLastName(v); clearErr('lastName'); }} />
        {err('lastName')}
        <TextInput style={inp('contact')} onLayout={at('contact')} placeholder="Contact Number (09XXXXXXXXX)" keyboardType="phone-pad" maxLength={13} value={contact} onChangeText={(v) => { setContact(v); clearErr('contact'); }} />
        {err('contact')}
        <View style={styles.row} onLayout={at('sex')}>
          {[{ id: 'female', label: '♀ Female' }, { id: 'male', label: '♂ Male' }].map((o) => (
            <TouchableOpacity key={o.id} style={[styles.pill, sex === o.id && styles.pillActive, errors.sex && styles.inputError]} onPress={() => { setSex(o.id); clearErr('sex'); }}>
              <Text style={[styles.pillText, sex === o.id && styles.pillTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {errors.sex ? <Text style={[styles.errorText, { marginTop: 4 }]}>{errors.sex}</Text> : null}
        <BirthdatePicker
          value={birthdate}
          onChange={(v) => { setBirthdate(v); clearErr('birthdate'); }}
          hasError={!!errors.birthdate}
          onLayout={at('birthdate')}
        />
        {err('birthdate')}
        <TouchableOpacity style={[styles.dropdownTrigger, errors.barangay && styles.inputError]} onLayout={at('barangay')} onPress={() => setBarangayModalVisible(true)}>
          <View style={styles.col}>
            <Text style={styles.dropdownName}>{barangay ? `Barangay ${barangay.barangay_name}` : 'Select Barangay'}</Text>
            <Text style={styles.dropdownDesc}>Cordova, Cebu</Text>
          </View>
          <Text style={styles.dropdownArrow}>▼</Text>
        </TouchableOpacity>
        {err('barangay')}
        <TextInput style={styles.input} placeholder="Sitio / Purok (helps responders find you)" value={sitio} onChangeText={setSitio} />
        <TextInput style={inp('emergName')} onLayout={at('emergName')} placeholder="Emergency Contact Person" value={emergName} onChangeText={(v) => { setEmergName(v); clearErr('emergName'); }} />
        {err('emergName')}
        <TextInput style={inp('emergContact')} onLayout={at('emergContact')} placeholder="Emergency Contact Number" keyboardType="phone-pad" value={emergContact} onChangeText={(v) => { setEmergContact(v); clearErr('emergContact'); }} />
        {err('emergContact')}

        {/* Housing Tenure & Floor Level */}
        <Text style={styles.miniLabel}>HOUSING OCCUPANCY & TENURE</Text>
        <View style={styles.row}>
          {TENURE_TYPES.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={[styles.pill, tenure === t.id && styles.pillActive]}
              onPress={() => setTenure(t.id)}
            >
              <Text style={[styles.pillText, tenure === t.id && styles.pillTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.miniLabel, { marginTop: 8 }]}>RESIDENCE FLOOR LEVEL (VERTICAL VULNERABILITY)</Text>
        <View style={styles.colGap}>
          {FLOOR_LEVELS.map((f) => (
            <TouchableOpacity
              key={f.id}
              style={[styles.levelOption, floorLevel === f.id && styles.levelOptionActive]}
              onPress={() => setFloorLevel(f.id)}
            >
              <Text style={[styles.levelText, floorLevel === f.id && styles.levelTextActive]}>
                {floorLevel === f.id ? '● ' : '○ '} {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {(tenure === 'renter' || tenure === 'boarder') && (
          <TextInput
            style={[styles.input, { marginTop: 6 }]}
            placeholder="Room / Unit / Apartment No. (e.g., Unit 2B, 2nd Door)"
            value={unitNo}
            onChangeText={setUnitNo}
          />
        )}

        {/* Repeatable Home Rooftop Geotag Calibration */}
        <View style={styles.geoTagCard}>
          <View style={styles.geoTagInfo}>
            <Text style={styles.geoTagTitle}>🏠 ROOFTOP RESIDENCE COORDINATES</Text>
            <Text style={styles.geoTagSub}>
              {homeCoords
                ? `Calibrated: ${homeCoords.lat.toFixed(5)}, ${homeCoords.lng.toFixed(5)}`
                : 'Calibrate your home location for zero-visibility emergency extraction.'}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.btnLockGeo, homeCoords && styles.btnLockGeoActive]}
            onPress={handleLockHomeLocation}
          >
            <Text style={styles.btnLockGeoText}>
              {homeCoords ? '🔄 Recalibrate' : '📍 Calibrate GPS'}
            </Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.btnUseLocation} onPress={() => setPickerOpen(true)}>
          <Text style={styles.btnUseLocationText}>📍 Use My Current Location</Text>
        </TouchableOpacity>

        {/* Representative Priority & Mobility Group */}
        <Text style={styles.miniLabel}>STEP 1: PRIORITY / AGE GROUP</Text>
        <View style={styles.grid2Col}>
          {RESIDENT_CATEGORIES.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[styles.gridChip, headCategory === c.id && styles.chipActive]}
              onPress={() => setHeadCategory(c.id)}
            >
              <Text style={[styles.chipText, headCategory === c.id && styles.chipTextActive]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.miniLabel, { marginTop: 10 }]}>STEP 2: PHYSICAL MOBILITY & PWD</Text>
        <View style={styles.grid2Col}>
          {RESIDENT_MOBILITIES.map((mob) => (
            <TouchableOpacity
              key={mob.id}
              style={[styles.gridChip, headMobility === mob.id && styles.chipMobilityActive]}
              onPress={() => setHeadMobility(mob.id)}
            >
              <Text style={[styles.chipText, headMobility === mob.id && styles.chipTextActive]}>{mob.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 2. Identity Verification */}
        <Text style={[styles.sectionHeader, { marginTop: 18 }]}>2. IDENTITY VERIFICATION (ADMIN REVIEW)</Text>
        <TouchableOpacity style={styles.dropdownTrigger} onPress={() => setIdModalVisible(true)}>
          <View style={styles.col}>
            <Text style={styles.dropdownName}>{selectedId.name}</Text>
            <Text style={styles.dropdownDesc}>{selectedId.desc}</Text>
          </View>
          <Text style={styles.dropdownArrow}>▼</Text>
        </TouchableOpacity>
        <TextInput style={inp('idNumber')} onLayout={at('idNumber')} placeholder="Control / Certificate Number" value={idNumber} onChangeText={(v) => { setIdNumber(v); clearErr('idNumber'); }} />
        {err('idNumber')}
        <TouchableOpacity style={[styles.btnUpload, errors.idImage && styles.inputError]} onLayout={at('idImage')} onPress={handleIdPhoto}>
          <Text style={styles.btnUploadText}>{idImageUri ? '✅ Valid ID Attached' : '🪪 Upload Photo of Valid ID'}</Text>
        </TouchableOpacity>
        {err('idImage')}
        {idImageUri && <Image source={{ uri: idImageUri }} style={styles.previewImg} />}

        {/* 3. Dynamic Household Members Roster */}
        <View style={styles.rosterHeaderRow}>
          <Text style={styles.sectionHeader}>3. HOUSEHOLD MEMBERS ({totalHeadcount} SOULS TOTAL)</Text>
          <TouchableOpacity style={styles.btnAddMember} onPress={handleAddMember}>
            <Text style={styles.btnAddMemberText}>+ Add Member</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.summaryBar}>
          <Text style={styles.summaryText}>
            Auto-Tally: {childrenCount} Child • {seniorsCount} Senior • {pregnantCount} Pregnant • {nonAmbulatoryCount} Bedridden/PWD
          </Text>
        </View>

        {members.map((member, index) => (
          <View key={member.id} style={[styles.memberCard, errors[`member_${member.id}`] && styles.inputError]} onLayout={at(`member_${member.id}`)}>
            <View style={styles.memberTopRow}>
              <Text style={styles.memberIndex}>FAMILY MEMBER #{index + 2}</Text>
              <TouchableOpacity onPress={() => handleRemoveMember(member.id)}>
                <Text style={styles.btnRemove}>✕ Remove</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={inp(`member_${member.id}`)}
              placeholder="Full Name (for Shelter & Missing Manifest)"
              value={member.name}
              onChangeText={(val) => { handleUpdateMember(member.id, 'name', val); clearErr(`member_${member.id}`); }}
            />
            {err(`member_${member.id}`)}
            <TextInput
              style={styles.input}
              placeholder="Relationship (e.g., Daughter, Mother)"
              value={member.relationship || ''}
              onChangeText={(val) => handleUpdateMember(member.id, 'relationship', val)}
            />

            <Text style={styles.miniLabel}>STEP 1: PRIORITY / AGE GROUP</Text>
            <View style={styles.grid2Col}>
              {RESIDENT_CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.gridChip, member.category === c.id && styles.chipActive]}
                  onPress={() => handleUpdateMember(member.id, 'category', c.id)}
                >
                  <Text style={[styles.chipText, member.category === c.id && styles.chipTextActive]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.miniLabel, { marginTop: 10 }]}>STEP 2: PHYSICAL MOBILITY & PWD</Text>
            <View style={styles.grid2Col}>
              {RESIDENT_MOBILITIES.map((mob) => (
                <TouchableOpacity
                  key={mob.id}
                  style={[styles.gridChip, member.mobility === mob.id && styles.chipMobilityActive]}
                  onPress={() => handleUpdateMember(member.id, 'mobility', mob.id)}
                >
                  <Text style={[styles.chipText, member.mobility === mob.id && styles.chipTextActive]}>{mob.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* 4. Structure & Micro-Navigation */}
        <Text style={[styles.sectionHeader, { marginTop: 18 }]}>4. STRUCTURE & MICRO-NAVIGATION</Text>
        <View style={styles.row}>
          {HOUSE_TYPES.map((h) => (
            <TouchableOpacity key={h.id} style={[styles.pill, houseType === h.id && styles.pillActive]} onPress={() => setHouseType(h.id)}>
              <Text style={[styles.pillText, houseType === h.id && styles.pillTextActive]}>{h.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          style={[styles.input, { marginTop: 10 }]}
          placeholder="Landmark (e.g., Blue gate across Aling Nena Store)"
          value={landmark}
          onChangeText={setLandmark}
        />

        {/* Geotagged House Facade */}
        <Text style={[styles.miniLabel, { marginTop: 6 }]}>GEOTAGGED HOUSE FACADE PHOTO</Text>
        <View style={styles.facadeBox}>
          {facadeImageUri ? (
            <TouchableOpacity onPress={() => setShowPreview(true)} activeOpacity={0.8}>
              <Image source={{ uri: facadeImageUri }} style={styles.facadeImg} />
              <View style={styles.zoomPill}><Text style={styles.zoomText}>🔍 View</Text></View>
            </TouchableOpacity>
          ) : (
            <View style={[styles.facadeImg, styles.facadePlaceholder]}>
              <Text style={{ fontSize: 24 }}>🏠</Text>
              <Text style={styles.facadePlaceholderText}>No Photo</Text>
            </View>
          )}

          <View style={styles.col}>
            <Text style={styles.facadeTitle}>Visual Structure Landmark</Text>
            <Text style={styles.facadeDesc}>
              {facadeImageUri ? 'Tap photo to preview in full screen.' : 'Add photo for emergency rescue verification.'}
            </Text>
            <View style={styles.row}>
              <TouchableOpacity style={styles.btnMedia} onPress={() => handleCamera()}>
                <Text style={styles.btnMediaText}>📷 Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnMedia, styles.btnMediaAlt]} onPress={() => handleGallery()}>
                <Text style={styles.btnMediaAltText}>🖼️ From Gallery</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* 5. Sign-in PIN */}
        <Text style={[styles.sectionHeader, { marginTop: 18 }]}>5. SIGN-IN PIN</Text>
        <Text style={styles.miniLabel}>YOU WILL SIGN IN WITH YOUR CONTACT NUMBER AND THIS PIN</Text>
        <TextInput style={inp('pin')} onLayout={at('pin')} placeholder="6-digit PIN" keyboardType="number-pad" secureTextEntry maxLength={6} value={pin} onChangeText={(v) => { setPin(v); clearErr('pin', 'pinConfirm'); }} />
        {err('pin')}
        <TextInput style={inp('pinConfirm')} onLayout={at('pinConfirm')} placeholder="Repeat PIN" keyboardType="number-pad" secureTextEntry maxLength={6} value={pinConfirm} onChangeText={(v) => { setPinConfirm(v); clearErr('pinConfirm'); }} />
        {err('pinConfirm')}

        <TouchableOpacity style={[styles.btnSubmit, submitting && { opacity: 0.7 }]} onPress={handleSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnSubmitText}>Submit Household Registration</Text>}
        </TouchableOpacity>
      </ScrollView>

      {/* Full-Screen Image Preview Modal */}
      {/* GPS pin on the map; saved with the registration */}
      <HomeLocationPicker
        visible={pickerOpen}
        fallback={homeCoords || (barangay?.center_lat ? { lat: Number(barangay.center_lat), lng: Number(barangay.center_lng) } : null)}
        onCancel={() => setPickerOpen(false)}
        onConfirm={(p) => {
          setHomeCoords({ lat: p.lat, lng: p.lng });
          setPickerOpen(false);
        }}
      />

      <Modal visible={showPreview} transparent animationType="fade">
        <View style={styles.fullscreenBg}>
          <View style={styles.fullscreenHeader}>
            <Text style={styles.fullscreenTitle}>House Facade Landmark</Text>
            <TouchableOpacity style={styles.btnClosePreview} onPress={() => setShowPreview(false)}>
              <Text style={styles.btnClosePreviewText}>✕ Close</Text>
            </TouchableOpacity>
          </View>
          {facadeImageUri && <Image source={{ uri: facadeImageUri }} style={styles.fullscreenImg} resizeMode="contain" />}
        </View>
      </Modal>

      {/* Barangay Selection Modal */}
      <Modal visible={barangayModalVisible} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setBarangayModalVisible(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Select Your Barangay</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {barangays.length === 0 && <Text style={styles.optionDesc}>Loading barangays… check your connection.</Text>}
              {barangays.map((b) => (
                <TouchableOpacity key={b.barangay_id} style={styles.optionRow} onPress={() => { setBarangay(b); clearErr('barangay'); setBarangayModalVisible(false); }}>
                  <Text style={styles.optionTitle}>{b.barangay_name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ID Selection Modal */}
      <Modal visible={idModalVisible} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setIdModalVisible(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Select Issued Credential</Text>
            {ID_TYPES.map((item) => (
              <TouchableOpacity key={item.id} style={styles.optionRow} onPress={() => { setSelectedId(item); setIdModalVisible(false); }}>
                <Text style={styles.optionTitle}>{item.name}</Text>
                <Text style={styles.optionDesc}>{item.desc}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  scrollContent: { padding: 16 },
  col: { flex: 1 },
  row: { flexDirection: 'row', gap: 8 },
  colGap: { gap: 6, marginVertical: 4 },

  sectionHeader: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#64748B', marginTop: 14, marginBottom: 6 },
  miniLabel: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#475569', marginBottom: 5, marginTop: 4 },
  input: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: FONT_SIZES.body, color: '#0F172A', fontWeight: FONT_WEIGHTS.medium, marginBottom: 8 },

  levelOption: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 6, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1' },
  levelOptionActive: { backgroundColor: '#EFF6FF', borderColor: '#1E3A8A' },
  levelText: { fontSize: FONT_SIZES.caption, color: '#475569', fontWeight: FONT_WEIGHTS.bold },
  levelTextActive: { color: '#1E3A8A', fontWeight: FONT_WEIGHTS.extraBold },

  geoTagCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
    marginBottom: 10,
  },
  geoTagInfo: { flex: 1, paddingRight: 8 },
  geoTagTitle: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#1E3A8A' },
  geoTagSub: { fontSize: FONT_SIZES.tiny, color: '#475569', marginTop: 2 },
  btnUseLocation: { backgroundColor: '#1E3A8A', borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginBottom: 10 },
  btnUseLocationText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
  btnLockGeo: { backgroundColor: '#1E3A8A', paddingVertical: 7, paddingHorizontal: 10, borderRadius: 6 },
  btnLockGeoActive: { backgroundColor: '#16A34A' },
  btnLockGeoText: { color: '#FFF', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold },

  dropdownTrigger: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 10, marginBottom: 8 },
  dropdownName: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.extraBold, color: '#0F172A' },
  dropdownDesc: { fontSize: FONT_SIZES.tiny, color: '#64748B' },
  dropdownArrow: { fontSize: FONT_SIZES.caption, color: '#1E3A8A', fontWeight: FONT_WEIGHTS.black },

  rosterHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 4 },
  btnAddMember: { backgroundColor: '#1E3A8A', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  btnAddMemberText: { color: '#FFF', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold },

  summaryBar: { backgroundColor: '#F1F5F9', padding: 8, borderRadius: 6, marginBottom: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  summaryText: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#1E3A8A', textAlign: 'center' },

  errorText: { color: '#DC2626', fontSize: 12, fontWeight: '700', marginTop: -4, marginBottom: 8 },
  inputError: { borderColor: '#DC2626', borderWidth: 1.5 },
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
  chipMobilityActive: { backgroundColor: '#0F766E', borderColor: '#0F766E' },
  chipText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#475569', textAlign: 'center' },
  chipTextActive: { color: '#FFF', fontWeight: FONT_WEIGHTS.extraBold },

  pill: { flex: 1, paddingVertical: 9, borderRadius: 8, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center' },
  pillActive: { backgroundColor: '#1E3A8A', borderColor: '#1E3A8A' },
  pillText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#475569' },
  pillTextActive: { color: '#FFF' },

  btnUpload: { backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1', borderStyle: 'dashed', borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginVertical: 4 },
  btnUploadText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#1E3A8A' },
  previewImg: { width: '100%', height: 120, borderRadius: 8, marginVertical: 6 },

  facadeBox: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: '#F8FAFC', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', marginTop: 4 },
  facadeImg: { width: 72, height: 72, borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1' },
  facadePlaceholder: { backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  facadePlaceholderText: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.bold, color: '#94A3B8', marginTop: 2 },
  zoomPill: { position: 'absolute', bottom: 3, left: 3, right: 3, backgroundColor: 'rgba(15,23,42,0.75)', borderRadius: 4, paddingVertical: 2, alignItems: 'center' },
  zoomText: { color: '#FFF', fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold },
  facadeTitle: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.extraBold, color: '#0F172A' },
  facadeDesc: { fontSize: FONT_SIZES.tiny, color: '#64748B', marginVertical: 3 },
  btnMedia: { backgroundColor: '#1E3A8A', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6 },
  btnMediaAlt: { backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1' },
  btnMediaText: { color: '#FFF', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold },
  btnMediaAltText: { color: '#1E3A8A', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold },

  btnSubmit: { backgroundColor: '#16A34A', paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 14, marginBottom: 24 },
  btnSubmitText: { color: '#FFF', fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.extraBold },

  fullscreenBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', padding: 14 },
  fullscreenHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingHorizontal: 8 },
  fullscreenTitle: { color: '#FFF', fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.extraBold },
  btnClosePreview: { backgroundColor: 'rgba(255,255,255,0.2)', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  btnClosePreviewText: { color: '#FFF', fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.extraBold },
  fullscreenImg: { width: '100%', height: '80%' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#FFF', borderRadius: 14, padding: 16 },
  modalTitle: { fontSize: FONT_SIZES.subtitle, fontWeight: FONT_WEIGHTS.extraBold, color: '#0F172A', marginBottom: 10 },
  optionRow: { paddingVertical: 9, borderBottomWidth: 1, borderColor: '#F1F5F9' },
  optionTitle: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.bold, color: '#1E293B' },
  optionDesc: { fontSize: FONT_SIZES.tiny, color: '#64748B' },
});