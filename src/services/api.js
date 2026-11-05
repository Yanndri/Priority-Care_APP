// Every call the app makes to Supabase, plus the mapping between the app's
// labels and the database's values. Screens import from here only.
import { File } from 'expo-file-system';
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
  if (/invalid login credentials/i.test(message)) return 'Wrong contact number / email or PIN / password.';
  if (/network request failed|fetch failed/i.test(message)) return 'No connection to the server. Check your internet and try again.';
  return message;
}
async function call(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(friendly(error));
  return data;
}

export async function signInResident(contact, pin) {
  if (!/^09\d{9}$/.test(normalizeContact(contact))) throw new Error('Enter your mobile number like 09171234567.');
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
      : 'This login is not a rescuer account. Admins use the web console.');
  }
  if (profile.account_status !== 'active') {
    await supabase.auth.signOut();
    throw new Error('This account is not active. Contact the MDRRMO.');
  }
  return profile;
}

export const signOut = () => supabase.auth.signOut();
export const getMyProfile = () => call(supabase.rpc('get_my_profile'));

// ---------------------------------------------------------------
// Registration
// ---------------------------------------------------------------

export const listBarangays = () =>
  call(supabase.from('barangays').select('barangay_id,barangay_name,center_lat,center_lng').order('barangay_name'));

// Official sitio list for a barangay, kept by barangay staff on the web (STEP14).
// Returns [] if the list does not exist yet.
// True when this mobile number already has an account. null when the check
// could not run (offline, or the database step is not applied yet); sign-up
// still refuses a taken number at the end.
export async function isContactRegistered(contact) {
  const { data, error } = await supabase.rpc('is_contact_registered', { p_contact: normalizeContact(contact) });
  return error ? null : Boolean(data);
}

export async function listSitios(barangayId) {
  if (barangayId == null) return [];
  const { data, error } = await supabase.from('sitios').select('sitio_id,sitio_name').eq('barangay_id', barangayId).order('sitio_name');
  if (error) return [];
  return data || [];
}

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
export const raiseSos = (type, coords, note = '') =>
  call(supabase.rpc('raise_sos', { p_type: type, p_lat: coords?.lat ?? null, p_lng: coords?.lng ?? null, p_note: note }));
// reason: 'self_evacuated' | 'threat_receded' | 'accidental'
export const cancelSos = (reason) => call(supabase.rpc('cancel_my_sos', { p_reason: reason }));
export const getHouseholdStatus = () => call(supabase.rpc('get_my_household_status'));
export const setMemberMissing = (memberId, missing, note = '') =>
  call(supabase.rpc('set_my_member_missing', { p_member_id: memberId, p_missing: missing, p_note: note }));
export const updateMyHousehold = (changes) => call(supabase.rpc('update_my_household', { p: changes }));
export const getPublicMap = () => call(supabase.rpc('get_public_map'));
// Pre-emptive evacuation (barangay's designated shelter first in centers[]).
export const getMyPreemptive = () => call(supabase.rpc('get_my_preemptive_evacuation'));
// memberIds: the family members who are with the account holder (each one is checked in at the centre).
export const reportMyPreemptive = ({ status, destinationType = null, centerId = null, address = '', headcount = null, note = '', memberIds = null }) =>
  call(supabase.rpc('report_my_preemptive_evacuation', {
    p_status: status, p_destination_type: destinationType, p_center_id: centerId,
    p_destination_address: address, p_headcount: headcount, p_note: note,
    ...(memberIds ? { p_member_ids: memberIds } : {}),
  }));
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
// Family reunification lookup across shelters (rescuers and staff). Needs the step 4 SQL.
export const searchEvacuees = (name) => call(supabase.rpc('search_field_evacuees', { p_query: name }));
export const admitWalkIn = ({ centerId, name, barangayId = null, sitio = '', headcount = 1, needs = '' }) =>
  call(supabase.rpc('admit_walk_in', {
    p_center_id: centerId, p_name: name, p_barangay_id: barangayId, p_sitio: sitio,
    p_headcount: headcount, p_needs: needs,
  }));

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
