// Resident sign-up: 4 short steps (About you, Your home, Your household, ID and PIN).
// One `step` number decides which block is shown. "Next" checks only the fields of
// the current step; the last step shows a review and creates the account.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, Image, Modal, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { listBarangays, listSitios, normalizeContact, registerResident } from '../../services/api';
import { useSession } from '../../components/SessionProvider';
import HomeLocationPicker from '../../components/HomeLocationPicker';
import BirthdatePicker from '../../components/BirthdatePicker';
import { ID_TYPES, RESIDENT_CATEGORIES, RESIDENT_MOBILITIES, HOUSE_TYPES } from '../../constants/options';
import { FONT_SIZES, FONT_WEIGHTS } from '../../constants/typography';
import { calculateVPI, getVPIPriority, determineRequiredGear } from '../../utils/vpi';

export const TENURE_TYPES = [
  { id: 'owner', label: 'Owner' },
  { id: 'renter', label: 'Renter' },
  { id: 'boarder', label: 'Boarder' },
];

export const FLOOR_LEVELS = [
  { id: 'ground', label: 'Ground' },
  { id: 'floor2', label: '2nd' },
  { id: 'floor3', label: '3rd or higher' },
];

// TEMPORARY for testing: true lets "Next" move on without checking the step.
// "Create my account" still checks everything. Set back to false before the defense.
const SKIP_STEP_CHECKS = true;

// Sitio choice meaning "my sitio isn't on the barangay's list" (saved as no sitio).
const NO_SITIO = '__none__';

const STEPS = ['About you', 'Your home', 'Your household', 'ID and PIN'];

// Which fields each step checks before "Next".
const STEP_FIELDS = [
  ['firstName', 'lastName', 'contact', 'sex', 'birthdate', 'emergName', 'emergContact'],
  ['barangay', 'sitio', 'landmark'],
  [], // household: the member pop-up already requires a name
  ['idNumber', 'idImage', 'pin', 'pinConfirm'],
];

const label = (list, id) => list.find((x) => x.id === id)?.label || '';

// ---------- small building blocks (no state of their own) ----------
const Label = ({ children, optional }) => (
  <Text style={styles.label}>{children}{optional ? <Text style={styles.optional}>  (optional)</Text> : null}</Text>
);

const Segment = ({ options, value, onChange, hasError }) => (
  <View style={[styles.segment, hasError && styles.inputError]}>
    {options.map((o) => (
      <TouchableOpacity key={o.id} style={[styles.segItem, value === o.id && styles.segItemOn]} onPress={() => onChange(o.id)}>
        <Text style={[styles.segText, value === o.id && styles.segTextOn]}>{o.label}</Text>
      </TouchableOpacity>
    ))}
  </View>
);

const Chips = ({ options, value, onChange, onStyle }) => (
  <View style={styles.chips}>
    {options.map((o) => (
      <TouchableOpacity key={o.id} style={[styles.chip, value === o.id && (onStyle || styles.chipOn)]} onPress={() => onChange(o.id)}>
        <Text style={[styles.chipText, value === o.id && styles.chipTextOn]}>{o.label}</Text>
      </TouchableOpacity>
    ))}
  </View>
);

const Select = ({ text, placeholder, onPress, hasError }) => (
  <TouchableOpacity style={[styles.input, styles.select, hasError && styles.inputError]} onPress={onPress}>
    <Text style={[styles.selectText, !text && styles.placeholder]} numberOfLines={1}>{text || placeholder}</Text>
    <Text style={styles.selectArrow}>▼</Text>
  </TouchableOpacity>
);


export default function RegisterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refresh } = useSession();
  const scrollRef = useRef(null);
  const [step, setStep] = useState(0);

  // Step 1: About you
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const name = [firstName, lastName].filter((x) => x.trim()).join(' ');
  const [contact, setContact] = useState('');
  const [sex, setSex] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [emergName, setEmergName] = useState('');
  const [emergContact, setEmergContact] = useState('');

  // Step 2: Your home
  const [barangays, setBarangays] = useState([]);
  const [barangay, setBarangay] = useState(null);
  const [sitios, setSitios] = useState([]);
  const [sitio, setSitio] = useState('');
  const [listModal, setListModal] = useState(null); // 'barangay' | 'sitio' | 'id' | null
  const [homeCoords, setHomeCoords] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [landmark, setLandmark] = useState('');
  const [facadeImage, setFacadeImage] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [houseType, setHouseType] = useState(HOUSE_TYPES[2].id);
  const [tenure, setTenure] = useState(TENURE_TYPES[0].id);
  const [floorLevel, setFloorLevel] = useState(FLOOR_LEVELS[0].id);
  const [unitNo, setUnitNo] = useState('');

  // Step 3: Your household
  const [headCategory, setHeadCategory] = useState(RESIDENT_CATEGORIES[0].id);
  const [headMobility, setHeadMobility] = useState(RESIDENT_MOBILITIES[0].id);
  const [members, setMembers] = useState([]);
  const [draft, setDraft] = useState(null); // member being added or edited in the pop-up

  // Step 4: ID and PIN
  const [selectedId, setSelectedId] = useState(ID_TYPES[0]);
  const [idNumber, setIdNumber] = useState('');
  const [idImage, setIdImage] = useState(null);
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Red messages under fields: key -> message
  const [errors, setErrors] = useState({});
  const clearErr = (...keys) => setErrors((prev) => {
    if (!keys.some((k) => prev[k])) return prev;
    const next = { ...prev };
    keys.forEach((k) => delete next[k]);
    return next;
  });
  const err = (key) => (errors[key] ? <Text style={styles.errorText}>{errors[key]}</Text> : null);
  const inp = (key) => [styles.input, errors[key] && styles.inputError];

  useEffect(() => {
    listBarangays().then(setBarangays).catch(() => setBarangays([]));
  }, []);

  // Official sitio list of the chosen barangay. Sitios are only picked, never typed;
  // the barangay admin keeps the list on the website (Sitios & Population).
  useEffect(() => {
    setSitio('');
    if (!barangay) return setSitios([]);
    listSitios(barangay.barangay_id).then(setSitios).catch(() => setSitios([]));
  }, [barangay?.barangay_id]);

  // ---------- photos ----------
  const pickPhoto = async (fromCamera, setAsset) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      return Alert.alert('Permission needed', fromCamera ? 'Allow camera access to take a photo.' : 'Allow photo access to choose a photo.');
    }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ allowsEditing: false, quality: 0.6 });
    if (!res.canceled && res.assets?.[0]?.uri) setAsset(res.assets[0]);
  };

  const handleIdPhoto = () => {
    Alert.alert('Photo of your ID', 'Make sure your name and ID number can be read.', [
      { text: 'Cancel', style: 'cancel' },
      { text: '📷 Take photo', onPress: () => pickPhoto(true, (a) => { setIdImage(a); clearErr('idImage'); }) },
      { text: '🖼️ From gallery', onPress: () => pickPhoto(false, (a) => { setIdImage(a); clearErr('idImage'); }) },
    ]);
  };

  // ---------- household members ----------
  const saveDraft = () => {
    if (!draft.name?.trim()) return Alert.alert('Name needed', "Enter this person's name.");
    const item = { ...draft, name: draft.name.trim() };
    setMembers((prev) => (draft.id ? prev.map((m) => (m.id === draft.id ? item : m)) : [...prev, { ...item, id: `M-${Date.now()}` }]));
    setDraft(null);
  };

  const allRoster = [{ name: name || 'Head', category: headCategory, mobility: headMobility }, ...members];
  const totalHeadcount = allRoster.length;
  const semiCount = allRoster.filter((m) => m.mobility === 'semi').length;
  const nonAmbulatoryCount = allRoster.filter((m) => m.mobility === 'non' || m.mobility === 'wheelchair').length;
  const childrenCount = allRoster.filter((m) => m.category === 'child').length;
  const seniorsCount = allRoster.filter((m) => m.category === 'senior').length;
  const pregnantCount = allRoster.filter((m) => m.category === 'pregnant').length;
  const cannotWalk = semiCount + nonAmbulatoryCount;

  // ---------- checking each step ----------
  const findErrors = () => {
    const e = {};
    if (!firstName.trim()) e.firstName = 'Enter your first name.';
    if (!lastName.trim()) e.lastName = 'Enter your last name.';
    if (!/^09\d{9}$/.test(normalizeContact(contact))) e.contact = 'Enter a mobile number like 0917 123 4567 or +63 917 123 4567.';
    if (!sex) e.sex = 'Choose Female or Male.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || Number.isNaN(Date.parse(birthdate))) e.birthdate = 'Choose your birthdate.';
    if (!emergName.trim()) e.emergName = 'Enter an emergency contact person.';
    if (!emergContact.trim()) e.emergContact = "Enter the emergency contact's number.";
    if (!barangay) e.barangay = 'Choose your barangay.';
    else if (sitios.length > 0 && !sitio) e.sitio = "Choose your sitio, or \"My sitio isn't listed\".";
    // No sitio to go by: the landmark is what helps responders find the house.
    if (barangay && (sitio === NO_SITIO || sitios.length === 0) && !landmark.trim()) {
      e.landmark = 'Enter a landmark near your house, since your sitio is not on the list.';
    }
    if (!idNumber.trim()) e.idNumber = 'Enter your ID number.';
    if (!idImage) e.idImage = 'Add a photo of your ID.';
    if (!/^\d{6}$/.test(pin)) e.pin = 'PIN must be exactly 6 digits.';
    else if (pin !== pinConfirm) e.pinConfirm = "PINs don't match.";
    return e;
  };

  const checkStep = (s) => {
    const all = findErrors();
    const mine = Object.fromEntries(Object.entries(all).filter(([k]) => STEP_FIELDS[s].includes(k)));
    setErrors(mine);
    return Object.keys(mine).length === 0;
  };

  const goTo = (s) => {
    setStep(s);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const handleNext = () => {
    if (SKIP_STEP_CHECKS) { setErrors({}); return goTo(step + 1); }
    if (!checkStep(step)) return scrollRef.current?.scrollTo({ y: 0, animated: true });
    if (step === 1 && !homeCoords) {
      return Alert.alert(
        'House not pinned yet',
        'Responders use the pin to find your house. You can pin it later from your Profile.',
        [{ text: 'Pin it now', onPress: () => setPickerOpen(true) }, { text: 'Later', onPress: () => goTo(step + 1) }],
      );
    }
    goTo(step + 1);
  };

  const handleSubmit = async () => {
    if (!checkStep(3)) return;
    // Earlier steps were checked on "Next", but check again in case something changed.
    for (let s = 0; s < 3; s += 1) {
      if (!checkStep(s)) return goTo(s);
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
        barangay_id: barangay.barangay_id, sitio: sitio === NO_SITIO ? '' : sitio, landmark: landmark.trim(),
        gps_lat: homeCoords?.lat, gps_long: homeCoords?.lng,
        house_type: houseType, tenure, floor_level: floorLevel, unit_no: unitNo.trim(),
        members, id_code: selectedId.id, id_number: idNumber.trim(), id_image: idImage, facade_image: facadeImage,
      });
      await refresh();
      Alert.alert(
        'Account created 🎉',
        `${name} (Brgy. ${barangay.barangay_name})\n• Household: ${totalHeadcount} people\n• Priority score: ${score} (${priority})\n• Equipment needed: ${gear}\n\nYour barangay will check your ID. Next time, sign in with ${normalizeContact(contact)} and your PIN.${warnings.length ? `\n\n⚠️ ${warnings.join('\n')}` : ''}`,
        [{ text: 'Open my home screen', onPress: () => router.replace('/(resident)') }],
      );
    } catch (e) {
      // A taken mobile number is refused here; send them back to fix it.
      if (/contact|number|mobile|registered/i.test(e.message || '')) {
        setErrors({ contact: e.message });
        goTo(0);
      }
      Alert.alert('Account not created', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- the four steps ----------
  const stepAboutYou = (
    <>
      <Label>First name</Label>
      <TextInput style={inp('firstName')} placeholder="e.g. Maria" value={firstName} onChangeText={(v) => { setFirstName(v); clearErr('firstName'); }} />
      {err('firstName')}
      <Label optional>Middle name</Label>
      <TextInput style={styles.input} placeholder="e.g. Cruz" value={middleName} onChangeText={setMiddleName} />
      <Label>Last name</Label>
      <TextInput style={inp('lastName')} placeholder="e.g. Santos" value={lastName} onChangeText={(v) => { setLastName(v); clearErr('lastName'); }} />
      {err('lastName')}
      <Label>Mobile number</Label>
      <TextInput style={inp('contact')} placeholder="e.g. 0917 123 4567 or +63 917 123 4567" keyboardType="phone-pad" maxLength={16} autoComplete="tel" textContentType="telephoneNumber" value={contact} onChangeText={(v) => { setContact(v); clearErr('contact'); }} />
      {errors.contact ? err('contact') : <Text style={styles.help}>You will sign in with this number.</Text>}
      <Label>Sex</Label>
      <Segment options={[{ id: 'female', label: 'Female' }, { id: 'male', label: 'Male' }]} value={sex} onChange={(v) => { setSex(v); clearErr('sex'); }} hasError={!!errors.sex} />
      {err('sex')}
      <Label>Birthdate</Label>
      <BirthdatePicker value={birthdate} onChange={(v) => { setBirthdate(v); clearErr('birthdate'); }} hasError={!!errors.birthdate} />
      {err('birthdate')}
      <Label>Emergency contact person</Label>
      <TextInput style={inp('emergName')} placeholder="Someone we can call about you" autoComplete="off" importantForAutofill="no" textContentType="none" value={emergName} onChangeText={(v) => { setEmergName(v); clearErr('emergName'); }} />
      {err('emergName')}
      <Label>Their number</Label>
      <TextInput style={inp('emergContact')} placeholder="e.g. 0917 123 4567 or +63 917 123 4567" keyboardType="phone-pad" maxLength={16} autoComplete="off" importantForAutofill="no" textContentType="none" value={emergContact} onChangeText={(v) => { setEmergContact(v); clearErr('emergContact'); }} />
      {err('emergContact')}
    </>
  );

  const stepYourHome = (
    <>
      <Label>Barangay</Label>
      <Select text={barangay?.barangay_name} placeholder="Choose your barangay" onPress={() => setListModal('barangay')} hasError={!!errors.barangay} />
      {err('barangay')}
      <Label>Sitio</Label>
      {barangay && sitios.length === 0 ? (
        <Text style={styles.notice}>
          Brgy. {barangay.barangay_name} has not added its sitio list yet. Skip this for now; you can choose your sitio later in your Profile.
        </Text>
      ) : (
        <Select
          text={sitio === NO_SITIO ? "My sitio isn't listed" : sitio}
          placeholder={barangay ? 'Choose your sitio' : 'Choose a barangay first'}
          onPress={() => barangay && setListModal('sitio')}
          hasError={!!errors.sitio}
        />
      )}
      {err('sitio')}

      <View style={styles.pinBox}>
        <Text style={styles.pinTitle}>{homeCoords ? '📍 House pinned' : '📍 House not pinned yet'}</Text>
        <Text style={styles.help}>
          {homeCoords
            ? `${homeCoords.lat.toFixed(5)}, ${homeCoords.lng.toFixed(5)}`
            : 'Responders use this pin to find your house. The map starts at your phone\'s location; tap the map to move the pin.'}
        </Text>
        <TouchableOpacity style={styles.btnPrimarySmall} onPress={() => setPickerOpen(true)}>
          <Text style={styles.btnPrimaryText}>{homeCoords ? '📍 Move my house pin' : '📍 Pin my house on the map'}</Text>
        </TouchableOpacity>
      </View>

      {barangay && (sitio === NO_SITIO || sitios.length === 0) ? <Label>Landmark</Label> : <Label optional>Landmark</Label>}
      <TextInput style={inp('landmark')} placeholder="e.g. Blue gate across Nena's Store" value={landmark} onChangeText={(v) => { setLandmark(v); clearErr('landmark'); }} />
      {err('landmark')}

      <Label optional>Photo of your house</Label>
      <View style={styles.photoRow}>
        {facadeImage?.uri ? (
          <TouchableOpacity onPress={() => setShowPreview(true)} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="View house photo">
            <Image source={{ uri: facadeImage.uri }} style={styles.thumb} />
            <View style={styles.viewPill}><Text style={styles.viewPillText}>🔍 View</Text></View>
          </TouchableOpacity>
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}><Text>🏠</Text><Text style={styles.thumbEmptyText}>No photo</Text></View>
        )}
        <View style={styles.photoButtons}>
          <TouchableOpacity style={styles.btnOutline} onPress={() => pickPhoto(true, setFacadeImage)}>
            <Text style={styles.btnOutlineText}>📷 Take photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnOutline} onPress={() => pickPhoto(false, setFacadeImage)}>
            <Text style={styles.btnOutlineText}>🖼️ From gallery</Text>
          </TouchableOpacity>
        </View>
      </View>
      <Text style={styles.help}>Take it from the street so responders recognize your house.</Text>

      <Label>House is made of</Label>
      <Segment options={HOUSE_TYPES} value={houseType} onChange={setHouseType} />
      <Label>You are the</Label>
      <Segment options={TENURE_TYPES} value={tenure} onChange={setTenure} />
      {(tenure === 'renter' || tenure === 'boarder') && (
        <>
          <Label optional>Room or unit number</Label>
          <TextInput style={styles.input} placeholder="e.g. Unit 2B" value={unitNo} onChangeText={setUnitNo} />
        </>
      )}
      <Label>Which floor do you live on?</Label>
      <Segment options={FLOOR_LEVELS} value={floorLevel} onChange={setFloorLevel} />
    </>
  );

  const stepHousehold = (
    <>
      <Label>You are</Label>
      <Chips options={RESIDENT_CATEGORIES} value={headCategory} onChange={setHeadCategory} />
      <Label>Can you walk on your own?</Label>
      <Chips options={RESIDENT_MOBILITIES} value={headMobility} onChange={setHeadMobility} onStyle={styles.chipWalkOn} />

      <Label>People living with you ({members.length})</Label>
      {members.length === 0 && <Text style={styles.help}>Add everyone who lives in your house, so responders know how many to bring.</Text>}
      {members.map((m) => (
        <View key={m.id} style={styles.personRow}>
          <View style={styles.flex}>
            <Text style={styles.personName}>{m.name}</Text>
            <Text style={styles.personSub}>
              {[m.relationship, label(RESIDENT_CATEGORIES, m.category), label(RESIDENT_MOBILITIES, m.mobility)].filter(Boolean).join(' • ')}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setDraft({ ...m })}><Text style={styles.linkText}>Edit</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setMembers((p) => p.filter((x) => x.id !== m.id))}><Text style={styles.removeText}>Remove</Text></TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity style={styles.btnOutline} onPress={() => setDraft({ name: '', relationship: '', category: 'adult', mobility: 'ambulatory' })}>
        <Text style={styles.btnOutlineText}>+ Add a person</Text>
      </TouchableOpacity>
      <View style={styles.tally}>
        <Text style={styles.tallyText}>
          {totalHeadcount} {totalHeadcount === 1 ? 'person' : 'people'} • {childrenCount} child • {seniorsCount} senior • {pregnantCount} pregnant • {cannotWalk} need help walking
        </Text>
      </View>
    </>
  );

  const stepIdAndPin = (
    <>
      <Label>Type of ID</Label>
      <Select text={selectedId.name} onPress={() => setListModal('id')} />
      <Label>ID number</Label>
      <TextInput style={inp('idNumber')} placeholder="Number printed on the ID" value={idNumber} onChangeText={(v) => { setIdNumber(v); clearErr('idNumber'); }} />
      {err('idNumber')}
      <TouchableOpacity style={[styles.btnOutline, errors.idImage && styles.inputError]} onPress={handleIdPhoto}>
        <Text style={styles.btnOutlineText}>{idImage ? '✅ ID photo added • Change' : '🪪 Add a photo of your ID'}</Text>
      </TouchableOpacity>
      {err('idImage')}
      {idImage?.uri && <Image source={{ uri: idImage.uri }} style={styles.idPreview} />}
      <Text style={styles.help}>Your barangay checks your ID. You can send an SOS before that.</Text>

      <View style={styles.row}>
        <View style={styles.flex}>
          <Label>6-digit PIN</Label>
          <TextInput style={inp('pin')} placeholder="••••••" keyboardType="number-pad" secureTextEntry maxLength={6} value={pin} onChangeText={(v) => { setPin(v); clearErr('pin', 'pinConfirm'); }} />
        </View>
        <View style={styles.flex}>
          <Label>Repeat PIN</Label>
          <TextInput style={inp('pinConfirm')} placeholder="••••••" keyboardType="number-pad" secureTextEntry maxLength={6} value={pinConfirm} onChangeText={(v) => { setPinConfirm(v); clearErr('pinConfirm'); }} />
        </View>
      </View>
      {err('pin')}
      {err('pinConfirm')}

      <Text style={[styles.label, { marginTop: 10 }]}>Check your details</Text>
      <View style={styles.review}>
        {[
          ['Name', [firstName, middleName, lastName].filter((x) => x.trim()).join(' '), 0],
          ['Mobile', normalizeContact(contact), 0],
          ['Home', [barangay?.barangay_name, sitio === NO_SITIO ? 'sitio not listed' : sitio].filter(Boolean).join(', '), 1],
          ['House pin', homeCoords ? 'Set ✓' : 'Not set', 1],
          ['House photo', facadeImage ? 'Added ✓' : 'None', 1],
          ['Household', `${totalHeadcount} ${totalHeadcount === 1 ? 'person' : 'people'}`, 2],
        ].map(([k, v, s]) => (
          <TouchableOpacity key={k} style={styles.reviewRow} onPress={() => goTo(s)}>
            <Text style={styles.reviewKey}>{k}</Text>
            <Text style={styles.reviewVal} numberOfLines={1}>{v || '—'}</Text>
            <Text style={styles.linkText}>Edit</Text>
          </TouchableOpacity>
        ))}
      </View>
    </>
  );

  const body = [stepAboutYou, stepYourHome, stepHousehold, stepIdAndPin][step];
  const isLast = step === STEPS.length - 1;

  // ---------- lists for the pop-up picker ----------
  const listOptions = {
    barangay: { title: 'Choose your barangay', items: barangays.map((b) => ({ key: b.barangay_id, title: b.barangay_name, pick: () => { setBarangay(b); clearErr('barangay'); } })) },
    sitio: {
      title: 'Choose your sitio',
      items: [
        ...sitios.map((s) => ({ key: s.sitio_name, title: s.sitio_name, pick: () => { setSitio(s.sitio_name); clearErr('sitio', 'landmark'); } })),
        { key: NO_SITIO, title: "My sitio isn't listed", desc: 'Your barangay will be told so they can add it.', pick: () => { setSitio(NO_SITIO); clearErr('sitio'); } },
      ],
    },
    id: { title: 'Type of ID', items: ID_TYPES.map((t) => ({ key: t.id, title: t.name, desc: t.desc, pick: () => setSelectedId(t) })) },
  }[listModal];

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {/* Step header with progress bar */}
      <View style={styles.header}>
        <Text style={styles.stepCount}>Step {step + 1} of {STEPS.length}</Text>
        <Text style={styles.stepTitle}>{STEPS[step]}</Text>
        <View style={styles.progress}>
          {STEPS.map((s, i) => <View key={s} style={[styles.progressBar, i <= step && styles.progressBarOn]} />)}
        </View>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>

      {/* One main button per screen */}
      <View style={styles.footer}>
        {step > 0 && (
          <TouchableOpacity style={[styles.btnBack]} onPress={() => { setErrors({}); goTo(step - 1); }} disabled={submitting}>
            <Text style={styles.btnBackText}>Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.btnMain, isLast && styles.btnCreate, submitting && { opacity: 0.7 }]}
          onPress={isLast ? handleSubmit : handleNext}
          disabled={submitting}
        >
          {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnMainText}>{isLast ? 'Create my account' : 'Next'}</Text>}
        </TouchableOpacity>
      </View>

      <HomeLocationPicker
        visible={pickerOpen}
        fallback={homeCoords || (barangay?.center_lat ? { lat: Number(barangay.center_lat), lng: Number(barangay.center_lng) } : null)}
        onCancel={() => setPickerOpen(false)}
        onConfirm={(p) => {
          setHomeCoords({ lat: p.lat, lng: p.lng });
          setPickerOpen(false);
        }}
      />

      {/* Full-screen house photo */}
      <Modal visible={showPreview && Boolean(facadeImage?.uri)} transparent animationType="fade" onRequestClose={() => setShowPreview(false)}>
        <View style={styles.fullscreenBg}>
          <View style={styles.fullscreenHeader}>
            <Text style={styles.fullscreenTitle}>Your house</Text>
            <TouchableOpacity style={styles.btnClosePreview} onPress={() => setShowPreview(false)}>
              <Text style={styles.btnClosePreviewText}>✕ Close</Text>
            </TouchableOpacity>
          </View>
          {facadeImage?.uri && <Image source={{ uri: facadeImage.uri }} style={styles.fullscreenImg} resizeMode="contain" />}
        </View>
      </Modal>

      {/* Pick from a list: barangay, sitio or ID type */}
      <Modal visible={Boolean(listOptions)} transparent animationType="fade" onRequestClose={() => setListModal(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setListModal(null)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{listOptions?.title}</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {listOptions?.items.length === 0 && <Text style={styles.help}>Loading… check your connection.</Text>}
              {listOptions?.items.map((it) => (
                <TouchableOpacity key={it.key} style={styles.optionRow} onPress={() => { it.pick(); setListModal(null); }}>
                  <Text style={styles.optionTitle}>{it.title}</Text>
                  {it.desc ? <Text style={styles.help}>{it.desc}</Text> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Add / edit a household member */}
      <Modal visible={Boolean(draft)} transparent animationType="fade" onRequestClose={() => setDraft(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{draft?.id ? 'Edit person' : 'Add a person'}</Text>
            <Label>Full name</Label>
            <TextInput style={styles.input} placeholder="e.g. Carlo Santos" value={draft?.name || ''} onChangeText={(v) => setDraft((p) => ({ ...p, name: v }))} />
            <Label optional>Relationship to you</Label>
            <TextInput style={styles.input} placeholder="e.g. Son, Mother" value={draft?.relationship || ''} onChangeText={(v) => setDraft((p) => ({ ...p, relationship: v }))} />
            <Label>This person is</Label>
            <Chips options={RESIDENT_CATEGORIES} value={draft?.category} onChange={(v) => setDraft((p) => ({ ...p, category: v }))} />
            <Label>Can they walk on their own?</Label>
            <Chips options={RESIDENT_MOBILITIES} value={draft?.mobility} onChange={(v) => setDraft((p) => ({ ...p, mobility: v }))} onStyle={styles.chipWalkOn} />
            <View style={[styles.row, { marginTop: 14 }]}>
              <TouchableOpacity style={styles.btnBack} onPress={() => setDraft(null)}>
                <Text style={styles.btnBackText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnMain} onPress={saveDraft}>
                <Text style={styles.btnMainText}>{draft?.id ? 'Save' : 'Add'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const NAVY = '#1E3A8A';
const LINE = '#CBD5E1';
const MUTED = '#64748B';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 8 },

  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, borderColor: '#E2E8F0' },
  stepCount: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: MUTED },
  stepTitle: { fontSize: FONT_SIZES.title, fontWeight: FONT_WEIGHTS.black, color: '#0F172A', marginTop: 2 },
  progress: { flexDirection: 'row', gap: 4, marginTop: 10 },
  progressBar: { flex: 1, height: 5, borderRadius: 3, backgroundColor: '#E2E8F0' },
  progressBarOn: { backgroundColor: NAVY },

  scrollContent: { padding: 16, paddingBottom: 24 },
  label: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#334155', marginTop: 10, marginBottom: 5 },
  optional: { fontWeight: FONT_WEIGHTS.medium, color: '#94A3B8' },
  help: { fontSize: FONT_SIZES.tiny, color: MUTED, marginTop: 4 },
  notice: { fontSize: FONT_SIZES.caption, color: '#92400E', backgroundColor: '#FEF3C7', borderRadius: 8, padding: 10, lineHeight: 18 },
  input: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: LINE, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: FONT_SIZES.body, color: '#0F172A', fontWeight: FONT_WEIGHTS.medium },
  inputError: { borderColor: '#DC2626', borderWidth: 1.5 },
  errorText: { color: '#DC2626', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, marginTop: 4 },
  select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectText: { flex: 1, fontSize: FONT_SIZES.body, color: '#0F172A', fontWeight: FONT_WEIGHTS.medium },
  placeholder: { color: '#94A3B8' },
  selectArrow: { fontSize: FONT_SIZES.caption, color: NAVY, fontWeight: FONT_WEIGHTS.black, marginLeft: 8 },

  segment: { flexDirection: 'row', borderWidth: 1, borderColor: LINE, borderRadius: 8, overflow: 'hidden' },
  segItem: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: '#FFFFFF' },
  segItemOn: { backgroundColor: NAVY },
  segText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#475569', textAlign: 'center' },
  segTextOn: { color: '#FFFFFF' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { width: '48%', flexGrow: 1, paddingVertical: 10, paddingHorizontal: 6, borderRadius: 8, borderWidth: 1, borderColor: LINE, backgroundColor: '#F8FAFC', alignItems: 'center' },
  chipOn: { backgroundColor: NAVY, borderColor: NAVY },
  chipWalkOn: { backgroundColor: '#0F766E', borderColor: '#0F766E' },
  chipText: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.bold, color: '#475569', textAlign: 'center' },
  chipTextOn: { color: '#FFFFFF' },

  pinBox: { backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE', borderRadius: 10, padding: 12, marginTop: 14, gap: 4 },
  pinTitle: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.extraBold, color: NAVY },
  btnPrimarySmall: { backgroundColor: NAVY, borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginTop: 6 },
  btnPrimaryText: { color: '#FFFFFF', fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.extraBold },

  photoRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  photoButtons: { flex: 1, gap: 8 },
  thumb: { width: 96, height: 80, borderRadius: 8, borderWidth: 1, borderColor: LINE },
  thumbEmpty: { backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  thumbEmptyText: { fontSize: FONT_SIZES.tiny, color: '#94A3B8', fontWeight: FONT_WEIGHTS.bold, marginTop: 2 },
  viewPill: { position: 'absolute', bottom: 4, left: 4, right: 4, backgroundColor: 'rgba(15,23,42,0.75)', borderRadius: 4, paddingVertical: 2, alignItems: 'center' },
  viewPillText: { color: '#FFFFFF', fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold },
  btnOutline: { borderWidth: 1, borderColor: LINE, backgroundColor: '#FFFFFF', borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 8 },
  btnOutlineText: { color: NAVY, fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold },
  idPreview: { width: '100%', height: 140, borderRadius: 8, marginTop: 8 },

  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 10, marginBottom: 6 },
  personName: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.extraBold, color: '#0F172A' },
  personSub: { fontSize: FONT_SIZES.tiny, color: MUTED, marginTop: 2 },
  linkText: { color: NAVY, fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold },
  removeText: { color: '#DC2626', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold },
  tally: { backgroundColor: '#F1F5F9', borderRadius: 8, padding: 8, marginTop: 12 },
  tallyText: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: NAVY, textAlign: 'center' },

  review: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, overflow: 'hidden' },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderColor: '#F1F5F9' },
  reviewKey: { width: 90, fontSize: FONT_SIZES.caption, color: MUTED, fontWeight: FONT_WEIGHTS.bold },
  reviewVal: { flex: 1, fontSize: FONT_SIZES.caption, color: '#0F172A', fontWeight: FONT_WEIGHTS.bold },

  footer: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderTopWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' },
  btnBack: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 8, paddingVertical: 13, alignItems: 'center' },
  btnBackText: { color: NAVY, fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.extraBold },
  btnMain: { flex: 2, backgroundColor: NAVY, borderRadius: 8, paddingVertical: 13, alignItems: 'center' },
  btnCreate: { backgroundColor: '#16A34A' },
  btnMainText: { color: '#FFFFFF', fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.extraBold },

  fullscreenBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', padding: 14 },
  fullscreenHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingHorizontal: 8 },
  fullscreenTitle: { color: '#FFFFFF', fontSize: FONT_SIZES.bodyBold, fontWeight: FONT_WEIGHTS.extraBold },
  btnClosePreview: { backgroundColor: 'rgba(255,255,255,0.2)', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  btnClosePreviewText: { color: '#FFFFFF', fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.extraBold },
  fullscreenImg: { width: '100%', height: '80%' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16 },
  modalTitle: { fontSize: FONT_SIZES.subtitle, fontWeight: FONT_WEIGHTS.extraBold, color: '#0F172A', marginBottom: 6 },
  optionRow: { paddingVertical: 11, borderBottomWidth: 1, borderColor: '#F1F5F9' },
  optionTitle: { fontSize: FONT_SIZES.body, fontWeight: FONT_WEIGHTS.bold, color: '#1E293B' },
});
