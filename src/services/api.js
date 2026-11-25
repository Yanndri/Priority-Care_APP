// Every call the app makes to Supabase, plus the mapping between the app's
// labels and the database's values. Screens import from here only.
import { File } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

// ---------------------------------------------------------------
// Value mapping (app <-> database)
// ---------------------------------------------------------------

// App mobility ids (RESIDENT_MOBILITIES) -> household_members.mobility
const MEMBER_MOBILITY = { ambulatory: 'ambulatory', semi: 'assisted', wheelchair: 'wheelchair', non: 'bedridden' };
// App mobility ids -> residents.mobility_status (the login holder)
const RESIDENT_MOBILITY = { ambulatory: 'ambulatory', semi: 'semi_ambulatory', wheelchair: 'non_ambulatory', non: 'non_ambulatory' };

export const MOBILITY_LABELS = {
  ambulatory: '🚶 Independent',
  assisted: '🦯 Assisted',
  semi_ambulatory: '🦯 Assisted',
  wheelchair: '♿ Wheelchair (PWD)',
  bedridden: '🦽 Bedridden',
  non_ambulatory: '🦽 Bedridden / Wheelchair',
};
export const AGE_GROUP_LABELS = { infant: '👶 Infant', child: '👶 Child (<12)', adult: '🧑 Adult', senior: '🧓 Senior (60+)' };

// App category (RESIDENT_CATEGORIES) -> age group + pregnancy flag
export function categoryToMember(category) {
  if (category === 'pregnant') return { age_group: 'adult', is_pregnant: true };
  return { age_group: category || 'adult', is_pregnant: false };
}
export const toMemberMobility = (id) => MEMBER_MOBILITY[id] || 'ambulatory';
const APP_MOBILITY = { ambulatory: 'ambulatory', assisted: 'semi', wheelchair: 'wheelchair', bedridden: 'non' };
// household_members row (household_members_json shape) -> the app's member form
export const memberToApp = (m) => ({
  ...m,
  id: m.member_id,
  category: m.is_pregnant ? 'pregnant' : (m.age_group === 'infant' ? 'child' : m.age_group || 'adult'),
  mobility: APP_MOBILITY[m.mobility] || 'ambulatory',
});
// The app's member form -> household_members_json shape (keeps fields the app does not edit)
export const memberToDb = (m) => ({
  member_id: m.member_id || '',
  name: m.name.trim(),
  relationship: m.relationship || '',
  sex: m.sex || '',
  birthdate: m.birthdate || '',
  needs: m.needs || '',
  mobility: toMemberMobility(m.mobility),
  ...(m.category === 'child' && m.age_group === 'infant' ? { age_group: 'infant', is_pregnant: false } : categoryToMember(m.category)),
  ...(Array.isArray(m.disability_ids) ? { disability_ids: m.disability_ids } : {}),
});
export const toResidentMobility = (id) => RESIDENT_MOBILITY[id] || 'ambulatory';

// Evacuation status from the database -> the app's member badge
export function personBadge(person) {
  if (person.missing) return 'MISSING';
  switch (person.evac_status) {
    case 'safely_evacuated': return 'ADMITTED';
    case 'in_transit': return 'IN TRANSIT';
    case 'pending': return 'AWAITING RESCUE';
    case 'failed': return 'NOT REACHED';
    default: return 'HOME';
  }
}

// ---------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------

// Same rule as public.normalize_contact_no / resident_login_email in the database.
export function normalizeContact(contact) {
  const d = String(contact || '').replace(/\D/g, '');
  if (/^63\d{10}$/.test(d)) return `0${d.slice(2)}`;
  if (/^9\d{9}$/.test(d)) return `0${d}`;
  return d;
}
export const residentLoginEmail = (contact) => `${normalizeContact(contact)}@resident.prioritycare.local`;

function friendly(error) {
  const message = error?.message || String(error);
  if (/invalid login credentials/i.test(message)) return 'Wrong mobile number / email or PIN / password.';
  if (/network request failed|fetch failed/i.test(message)) return 'No connection to the server. Check your internet and try again.';
  return message;
}
async function call(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(friendly(error));
  return data;
}

export async function signInResident(contact, pin) {
  if (!/^09\d{9}$/.test(normalizeContact(contact))) throw new Error('Enter a mobile number like 0917 123 4567 or +63 917 123 4567.');
  await call(supabase.auth.signInWithPassword({ email: residentLoginEmail(contact), password: pin }));
  return assertRole('resident');
}

export async function signInRescuer(email, password) {
  await call(supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password }));
  return assertRole('rescuer');
}

async function assertRole(role) {
  const profile = await getMyProfile();
  if (!profile || profile.role !== role) {
    await supabase.auth.signOut();
    throw new Error(role === 'resident'
      ? 'This login is not a household account.'
      : 'This login is not a responder account. Admins use the website.');
  }
  if (profile.account_status !== 'active') {
    await supabase.auth.signOut();
    throw new Error('This account is not active. Contact the MDRRMO.');
  }
  return profile;
}

// Signing out also removes the responder's saved offline copy of residents (rescuerFeed.js).
export const signOut = async () => {
  await AsyncStorage.removeItem('pc.rescuerFeed.v1').catch(() => {});
  return supabase.auth.signOut();
};
export const getMyProfile = () => call(supabase.rpc('get_my_profile'));

// Forgot PIN (pin-reset Edge Function). Prototype: the SMS is simulated, so the
// function returns the text message and the app shows it as a notification.
async function pinReset(body) {
  const { data, error } = await supabase.functions.invoke('pin-reset', { body });
  if (error) {
    const context = error.context;
    const detail = context ? await context.json().catch(() => null) : null;
    if (!detail && context?.status === 404) throw new Error('Forgot PIN is not set up on the server yet.');
    throw new Error(detail?.error || friendly(error));
  }
  if (!data?.ok) throw new Error(data?.error || 'Something went wrong. Try again.');
  return data;
}
export const requestPinResetCode = (contact) => pinReset({ action: 'send', contact: normalizeContact(contact) });
export async function resetPinWithCode(contact, code, newPin) {
  await pinReset({ action: 'verify', contact: normalizeContact(contact), code, new_pin: newPin });
  return signInResident(contact, newPin);
}

// Change PIN (residents) or password (responders). The current one is checked first,
// so someone holding an unlocked phone can't take over the account.
export async function changeMyPasscode(current, next) {
  const { data: { session } } = await supabase.auth.getSession();
  const email = session?.user?.email;
  if (!email) throw new Error('Please sign in again.');
  const { error: checkError } = await supabase.auth.signInWithPassword({ email, password: current });
  if (checkError) {
    throw new Error(/invalid login credentials/i.test(checkError.message || '')
      ? 'The current PIN or password is wrong.' : friendly(checkError));
  }
  await call(supabase.auth.updateUser({ password: next }));
}

// ---------------------------------------------------------------
// Registration
// ---------------------------------------------------------------

export const listBarangays = () =>
  call(supabase.from('barangays').select('barangay_id,barangay_name,center_lat,center_lng').order('barangay_name'));

// Official sitio names of one barangay (staff keep the list on the web "Sitios & Population" page).
export const listSitios = (barangayId) =>
  call(supabase.from('sitios').select('sitio_name').eq('barangay_id', barangayId).order('sitio_name'));

export const listDocumentTypes = () =>
  call(supabase.from('document_types').select('type_id,type_name,code').order('type_id'));

// form: { pin, f_name, m_name, l_name, contact_no, sex, birthdate, mobility (app id), category (app id),
//         emerg_contact_name, emerg_contact_no, barangay_id, sitio, landmark, gps_lat, gps_long,
//         house_type, tenure, floor_level, unit_no, members: [{ name, category, mobility }],
//         id_code, id_number, id_image (picker asset), facade_image (picker asset) }
// Returns { profile, warnings[] }: the login exists once the first step succeeds;
// photo uploads that fail afterwards are reported as warnings, not errors.
export async function registerResident(form) {
  const head = categoryToMember(form.category);
  const body = {
    pin: form.pin,
    f_name: form.f_name, m_name: form.m_name, l_name: form.l_name,
    contact_no: form.contact_no, sex: form.sex, birthdate: form.birthdate,
    mobility_status: toResidentMobility(form.mobility),
    is_pregnant: head.is_pregnant,
    emerg_contact_name: form.emerg_contact_name, emerg_contact_no: form.emerg_contact_no,
    barangay_id: form.barangay_id, sitio: form.sitio, landmark: form.landmark,
    gps_lat: form.gps_lat ?? null, gps_long: form.gps_long ?? null,
    household: {
      house_type: form.house_type, tenure: form.tenure, floor_level: form.floor_level, unit_no: form.unit_no || '',
      members: form.members
        .filter((m) => m.name.trim())
        .map((m) => ({ name: m.name.trim(), relationship: m.relationship || '', mobility: toMemberMobility(m.mobility),
                       ...categoryToMember(m.category), needs: m.needs || '' })),
    },
  };
  const { data, error } = await supabase.functions.invoke('register-resident', { body });
  if (error) {
    // The function answers 4xx with { error }; surface that message.
    let message = error.message;
    try { message = (await error.context.json()).error || message; } catch { /* keep the generic message */ }
    throw new Error(friendly(message));
  }
  if (data?.error) throw new Error(data.error);

  const profile = await signInResident(form.contact_no, form.pin);
  const warnings = [];
  if (form.id_image) {
    try {
      const path = await uploadImage('verification-docs', 'id', form.id_image);
      const types = await listDocumentTypes();
      const type = types.find((t) => t.code === form.id_code) || types.find((t) => t.code === 'other');
      await call(supabase.rpc('submit_my_verification_document', {
        p_type_id: type.type_id, p_path: path, p_id_number: form.id_number || '',
      }));
    } catch (e) { warnings.push(`ID photo was not uploaded (${e.message}). You can add it later from your profile.`); }
  }
  if (form.facade_image) {
    try {
      const path = await uploadImage('house-facades', 'front', form.facade_image);
      await call(supabase.rpc('set_my_house_photo', { p_path: path }));
    } catch (e) { warnings.push(`House photo was not uploaded (${e.message}). You can add it later from your profile.`); }
  }
  return { profile, warnings };
}

// ---------------------------------------------------------------
// Files (private buckets; files live under <user id>/...)
// ---------------------------------------------------------------

export async function uploadImage(bucket, prefix, asset) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in first.');
  const contentType = asset.mimeType || 'image/jpeg';
  const ext = contentType.split('/')[1] === 'png' ? 'png' : 'jpg';
  const path = `${user.id}/${prefix}-${Date.now()}.${ext}`;
  // fetch(uri).arrayBuffer() returns an empty body for local files on Android, so read the bytes directly.
  const bytes = await new File(asset.uri).bytes();
  if (!bytes?.length) throw new Error('Could not read the photo. Please take it again.');
  await call(supabase.storage.from(bucket).upload(path, bytes, { contentType, upsert: false }));
  return path;
}

// Short-lived link for showing a private photo; null when there is none.
export async function signedPhotoUrl(bucket, path) {
  if (!path) return null;
  if (/^https?:/.test(path)) return path;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
  return error ? null : data.signedUrl;
}

// ---------------------------------------------------------------
// Resident
// ---------------------------------------------------------------

export const getMySos = () => call(supabase.rpc('get_my_sos'));
// who: { headcount, withMembers } -- how many people are with the resident in total (1-50) and
// which household members (member_ids). Falls back to older database versions if STEP29/30 aren't applied.
export async function raiseSos(type, coords, note = '', who = {}) {
  const args = { p_type: type, p_lat: coords?.lat ?? null, p_lng: coords?.lng ?? null, p_note: note };
  const tries = [];
  if (who.headcount && who.withMembers) tries.push({ ...args, p_headcount: who.headcount, p_with_members: who.withMembers });
  if (who.headcount) tries.push({ ...args, p_headcount: who.headcount });
  for (const a of tries) {
    const { data, error } = await supabase.rpc('raise_sos', a);
    if (!error) return data;
    if (!/p_headcount|p_with_members|could not find the function|raise_sos/i.test(error.message || '')) throw new Error(friendly(error));
  }
  return call(supabase.rpc('raise_sos', args));
}
// reason: 'self_evacuated' | 'threat_receded' | 'accidental'
export const cancelSos = (reason) => call(supabase.rpc('cancel_my_sos', { p_reason: reason }));
// STEP30: per ticket, whether the resident ticked who is with them on the SOS, and who.
// Returns {} if STEP30 isn't applied, so the whole household is used as before.
export async function getTicketSosMembers(ticketIds) {
  const ids = (ticketIds || []).filter(Boolean);
  if (!ids.length) return {};
  const { data, error } = await supabase.rpc('get_ticket_sos_members', { p_ticket_ids: ids });
  return error ? {} : data || {};
}
export const getHouseholdStatus = () => call(supabase.rpc('get_my_household_status'));
export const setMemberMissing = (memberId, missing, note = '') =>
  call(supabase.rpc('set_my_member_missing', { p_member_id: memberId, p_missing: missing, p_note: note }));
export const updateMyHousehold = (changes) => call(supabase.rpc('update_my_household', { p: changes }));
export const getPublicMap = () => call(supabase.rpc('get_public_map'));
// Pre-emptive evacuation (nearest open center with room first in centers[]).
export const getMyPreemptive = () => call(supabase.rpc('get_my_preemptive_evacuation'));
export const reportMyPreemptive = ({ status, destinationType = null, centerId = null, address = '', headcount = null, note = '' }) =>
  call(supabase.rpc('report_my_preemptive_evacuation', {
    p_status: status, p_destination_type: destinationType, p_center_id: centerId,
    p_destination_address: address, p_headcount: headcount, p_note: note,
  }));
// Check out of an evacuation center (STEP 28). people: uids / member_ids leaving, or null for everyone.
// Before STEP 28 is run, "everyone" still works through the household's "Back home" report.
export async function checkOutMyHousehold(people = null) {
  try {
    return await call(supabase.rpc('check_out_my_household', { p_people: people }));
  } catch (e) {
    if (people == null && /check_out_my_household|could not find the function/i.test(e.message)) {
      return reportMyPreemptive({ status: 'returned_home', note: 'Checked out in the app' });
    }
    throw e;
  }
}
export async function setMyHousePhoto(asset) {
  const path = await uploadImage('house-facades', 'front', asset);
  await call(supabase.rpc('set_my_house_photo', { p_path: path }));
  return path;
}

// ---------------------------------------------------------------
// Hazards (residents and rescuers report; rescuers review)
// ---------------------------------------------------------------

export const reportHazard = ({ type, description, lat, lng, barangayId = null, photoPath = null }) =>
  call(supabase.rpc('report_hazard', {
    p_type: type, p_description: description || '', p_lat: lat, p_lng: lng,
    p_barangay_id: barangayId, p_photo_path: photoPath,
  }));
// action: 'confirm' | 'review' | 'dismiss' | 'resolve'
export const reviewHazard = (hazardId, action, note = '') =>
  call(supabase.rpc('review_hazard', { p_hazard_id: hazardId, p_action: action, p_note: note }));

// ---------------------------------------------------------------
// Rescuer
// ---------------------------------------------------------------

export const getRescuerFeed = () => call(supabase.rpc('get_rescuer_feed'));
// status: 'acknowledged' | 'en_route' | 'on_scene' | 'resolved' (a note is required to resolve)
export const updateTicketStatus = (ticketId, status, note = '') =>
  call(supabase.rpc('update_dispatch_status', { p_ticket_id: ticketId, p_status: status, p_note: note }));
// person: { kind: 'resident', uid } or { kind: 'member', member_id }
export const recordEvacuation = (person, centerId, status) =>
  call(supabase.rpc('record_evacuation', {
    p_resident_uid: person.kind === 'resident' ? person.uid : null,
    p_member_id: person.kind === 'member' ? person.member_id : null,
    p_center_id: centerId ?? null, p_status: status,
  }));
// Backup requests (STEP 20): the assigned unit asks for extra help; the web shows them.
export const BACKUP_NEEDS = {
  boat: { icon: '🚤', label: 'Rescue boat', desc: 'For flood water deeper than 1 meter.' },
  ambulance: { icon: '🚑', label: 'Ambulance', desc: 'For several injured people or a serious case.' },
  stretcher: { icon: '🛏️', label: 'Stretcher / spine board', desc: 'For bedridden or badly injured people.' },
  road_clearing: { icon: '🪓', label: 'Road clearing', desc: 'A fallen tree or debris is blocking the way.' },
  more_people: { icon: '👥', label: 'More responders', desc: 'Too many people to carry or guide.' },
};
export const getBackupRequests = () => call(supabase.rpc('get_backup_requests'));
export const requestBackup = (ticketId, need, note = '') =>
  call(supabase.rpc('request_backup', { p_ticket_id: ticketId, p_need: need, p_note: note }));
export const cancelBackupRequest = (requestId) =>
  call(supabase.rpc('close_backup_request', { p_request_id: requestId, p_action: 'cancel' }));

// Hazard alarms (STEP 20): "I see it too" from people within 10 km, and the alarm level
// (1 + confirmations + other reports of the same type within 300 m).
export const getHazardAlarms = () => call(supabase.rpc('get_hazard_alarms'));
export const confirmHazard = (hazardId, coords) =>
  call(supabase.rpc('confirm_hazard', { p_hazard_id: hazardId, p_lat: coords?.lat ?? null, p_lng: coords?.lng ?? null }));
export const getNearbyHazards = (coords) =>
  call(supabase.rpc('get_nearby_hazards', { p_lat: coords.lat, p_lng: coords.lng }));
export const alarmLabel = (level) => (level >= 3 ? '3rd alarm' : level === 2 ? '2nd alarm' : '1st alarm');

export const admitWalkIn = ({ centerId, name, barangayId = null, sitio = '', headcount = 1, needs = '' }) =>
  call(supabase.rpc('admit_walk_in', {
    p_center_id: centerId, p_name: name, p_barangay_id: barangayId, p_sitio: sitio,
    p_headcount: headcount, p_needs: needs,
  }));

// ---------------------------------------------------------------
// Rescue missions: arrival, evacuation center, check-in (needs 20261116_01_live_rescue_tracking.sql).
// The unit's live position is no longer sent (status updates only, to save battery).
// ---------------------------------------------------------------

export const getMissionStatus = (ticketId) => call(supabase.rpc('get_mission_status', { p_ticket_id: ticketId }));
export const getMyRescueTracking = () => call(supabase.rpc('get_my_rescue_tracking'));
export const getCenterAvailability = () => call(supabase.rpc('get_center_availability'));
// Who is inside a center (rescuers: any center; barangay staff: their own), and checking people out.
export const getCenterRoster = (centerId) => call(supabase.rpc('get_center_roster', { p_center_id: centerId }));
export const checkOutEvacuees = (centerId, recordIds) =>
  call(supabase.rpc('check_out_evacuees', { p_center_id: centerId, p_record_ids: recordIds }));
// Rescuer confirms arrival at the resident (the resident is told).
// Undo a mis-tapped "Accept & go" or "I'm with them" (STEP35). Logged in the ticket history.
export const undoLastRescueStep = (ticketId) => call(supabase.rpc('undo_last_rescue_step', { p_ticket_id: ticketId }));

export const confirmResidentLocated = (ticketId, fix) =>
  call(supabase.rpc('confirm_resident_located', {
    p_ticket_id: ticketId, p_lat: fix?.lat ?? null, p_lng: fix?.lng ?? null, p_accuracy: fix?.accuracy ?? null,
  }));
// Re-run center selection (e.g. to transfer: pass the current center in exclude).
// roadOrder: center ids sorted by road distance; the server reserves the first one that still has room.
export const assignEvacuationCenter = (ticketId, { fix = null, centerId = null, exclude = [], roadOrder = null } = {}) =>
  call(supabase.rpc('assign_evacuation_center', {
    p_ticket_id: ticketId, p_lat: fix?.lat ?? null, p_lng: fix?.lng ?? null, p_center_id: centerId, p_exclude: exclude,
    p_road_order: roadOrder,
  }));
// Rescuer leaves for the reserved center with the household (tells the resident once).
export const startEvacuation = (ticketId) => call(supabase.rpc('start_evacuation', { p_ticket_id: ticketId }));
export const releaseEvacuationReservation = (ticketId, reason) =>
  call(supabase.rpc('release_evacuation_reservation', { p_ticket_id: ticketId, p_reason: reason }));
export const confirmEvacuationArrival = (ticketId, note = '') =>
  call(supabase.rpc('confirm_evacuation_arrival', { p_ticket_id: ticketId, p_note: note }));

// ---------------------------------------------------------------
// Live updates: calls onChange whenever a row the user can see changes.
// Returns an unsubscribe function.
// ---------------------------------------------------------------
export function subscribe(tables, onChange) {
  const channel = supabase.channel(`pc-${tables.join('-')}-${Date.now()}`);
  tables.forEach((table) => channel.on('postgres_changes', { event: '*', schema: 'public', table }, onChange));
  channel.subscribe();
  return () => { supabase.removeChannel(channel); };
}

// Calls onChange when the database reports a change in any of the given topics
// (public.live_signals: events, centers, shelter_plans, sos, tickets, units, evacuation,
// hazards, missing, preemptive, residents, accounts). The signal only says that something
// changed; the screen then reloads through its usual RPCs. Bursts are merged into one call.
export function onLiveSignal(topics, onChange) {
  let timer = null;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 400);
  };
  const channel = supabase
    .channel(`pc-signals-${topics.join("-")}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'live_signals' }, (payload) => {
      if (topics.includes(payload.new?.topic)) fire();
    })
    .subscribe();
  return () => { clearTimeout(timer); supabase.removeChannel(channel); };
}

// Closed hazard reports (resolved or marked false) for the responder Hazards "History" filter.
export async function getHazardHistory(limit = 50) {
  const { data, error } = await supabase
    .from('hazard_reports')
    .select('hazard_id, hazard_type, description, status, latitude, longitude, barangay_id, photo_path, reporter_role, created_at, reviewed_at, review_note')
    .in('status', ['resolved', 'dismissed'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Hazards this resident reported, with what happened to each (resident Hazards screen, "My reports").
export async function getMyHazardReports(limit = 30) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('hazard_reports')
    .select('hazard_id, hazard_type, description, status, latitude, longitude, barangay_id, created_at, reviewed_at, review_note, event_id')
    .eq('reported_by', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Take back your own hazard report (misclick or mistake) while nobody has confirmed it yet (STEP22).
export const withdrawMyHazard = (hazardId) =>
  call(supabase.rpc('withdraw_my_hazard', { p_hazard_id: hazardId }));

// Take back an "I see it too" (misclick), STEP23.
export const unconfirmHazard = (hazardId) =>
  call(supabase.rpc('unconfirm_hazard', { p_hazard_id: hazardId }));

// Who reported each hazard: name, role and number, for responders and staff only (STEP24).
// Returns {} when STEP24 is not run yet, so screens fall back to "Resident" / "Responder".
export async function getHazardReporters(ids) {
  if (!ids?.length) return {};
  const { data, error } = await supabase.rpc('get_hazard_reporters', { p_ids: ids });
  if (error) return {};
  return Object.fromEntries((data || []).map((r) => [r.hazard_id, r]));
}

const ROLE_WORD = { resident: 'Resident', rescuer: 'Responder' };
// "Juan Dela Cruz (Resident) • 0917…" or just "Resident" when the name is not known.
export function reporterLabel(role, who) {
  const word = ROLE_WORD[role] || 'MDRRMO staff';
  const unverified = who?.reporter_verified === false ? ' • account not verified' : '';
  if (!who?.reporter_name) return word + unverified;
  return `${who.reporter_name} (${word})${who.contact_no ? ` • ${who.contact_no}` : ''}${unverified}`;
}

// Residents whose account the barangay has not verified yet (responders can read resident accounts).
export async function getUnverifiedResidents(uids) {
  const ids = [...new Set((uids || []).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await supabase.from('users').select('uid, is_verified').in('uid', ids);
  if (error) return [];
  return (data || []).filter((u) => !u.is_verified).map((u) => u.uid);
}

// Ended disasters, newest first (STEP27). Residents get their own barangay; responders all of Cordova.
export const getDisasterHistory = (limit = 30) =>
  call(supabase.rpc('get_disaster_history', { p_limit: limit }));
