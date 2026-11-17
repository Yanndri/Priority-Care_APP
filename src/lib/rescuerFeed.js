// Loads get_rescuer_feed and turns it into the incident shape the rescuer
// screens were built around (one entry per SOS / dispatch ticket).
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EMERGENCY_TYPES } from '../constants/mockData';
import { getHazardReporters, getUnverifiedResidents, getTicketSosMembers, reporterLabel, getRescuerFeed, listBarangays, memberToApp, personBadge, subscribe, onLiveSignal, MOBILITY_LABELS, AGE_GROUP_LABELS } from '../services/api';
import { calculateVPI, getVPIPriority, determineRequiredGear } from '../utils/vpi';
import { toMapHazard, toMapShelter } from './mapData';

// dispatch_tickets.status -> the screens' step names
const TICKET_STEP = { assigned: 'PENDING', acknowledged: 'ACCEPTED', en_route: 'EN_ROUTE', on_scene: 'ON_SCENE' };
const PRIORITY_COLOR = { CRITICAL: '#DC2626', ASSISTED: '#D97706', LOW: '#16A34A' };

export const timeAgo = (iso) => {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} hr${hours === 1 ? '' : 's'} ago` : `${Math.round(hours / 24)} d ago`;
};

const emergencyLabel = (type) => {
  const t = EMERGENCY_TYPES.find((e) => e.id === type);
  return t ? `${t.icon} ${t.label}` : `⚠️ ${type || 'Emergency'}`;
};

const ageOf = (birthdate) =>
  (birthdate ? Math.floor((Date.now() - new Date(birthdate).getTime()) / (365.25 * 864e5)) : 0);

function toPerson(p) {
  const app = p.kind === 'member' ? memberToApp(p) : {
    ...p,
    category: ageOf(p.birthdate) >= 60 ? 'senior' : 'adult',
    mobility: { semi_ambulatory: 'semi', non_ambulatory: 'non' }[p.mobility] || 'ambulatory',
  };
  return {
    ...app,
    id: p.member_id || p.uid,
    role: [p.kind === 'resident' ? 'Account holder' : p.relationship, AGE_GROUP_LABELS[p.age_group], MOBILITY_LABELS[p.mobility]]
      .filter(Boolean).join(' • '),
    status: personBadge(p),
  };
}

function vulnerability(people, houseType) {
  const count = (fn) => people.filter(fn).length;
  const counts = {
    nonAmbulatoryCount: count((p) => ['bedridden', 'wheelchair', 'non_ambulatory'].includes(p.mobility)),
    semiCount: count((p) => ['assisted', 'semi_ambulatory'].includes(p.mobility)),
    childrenCount: count((p) => ['infant', 'child'].includes(p.age_group)),
    seniorsCount: count((p) => p.age_group === 'senior' || (p.kind === 'resident' && ageOf(p.birthdate) >= 60)),
    pregnantCount: count((p) => p.is_pregnant),
  };
  return { score: calculateVPI({ ...counts, houseType }), gear: determineRequiredGear(counts) };
}

function fromTicket(t, myUnitName) {
  const everyone = t.resident?.household?.people || [];
  // Only the household members the resident ticked as with them (STEP30); not given = everyone.
  const listed = t.sos_with?.listed ? new Set(t.sos_with.member_ids || []) : null;
  const people = listed ? everyone.filter((p) => p.kind === 'resident' || listed.has(p.member_id)) : everyone;
  // Away from home, their own house type says nothing about where they are now.
  const v = vulnerability(people, t.sos?.visiting_from ? null : t.resident?.household?.house_type);
  const level = t.sos?.alert_level;
  const priority = t.priority === 'critical' || level === 3 ? 'CRITICAL'
    : t.priority === 'high' || level === 2 ? 'ASSISTED' : getVPIPriority(v.score);
  const lat = Number(t.latitude);
  const lng = Number(t.longitude);
  return {
    id: `T-${t.ticket_id}`,
    ticketId: t.ticket_id,
    ticketNo: t.ticket_no,
    isMine: true,
    name: t.resident?.name || t.subject,
    residentUid: t.resident?.uid || null,
    contact: t.resident?.contact_no || '',
    contact2: '',
    barangay: t.barangay_name,
    // A visitor's registered sitio is in another barangay, so say where they are from instead.
    sitio: t.sos?.visiting_from ? `visiting from Brgy. ${t.sos.visiting_from}` : t.resident?.sitio || '',
    homeLat: lat,
    homeLng: lng,
    lat,
    lng,
    reportedAt: timeAgo(t.sos?.created_at || t.created_at),
    createdAt: t.sos?.created_at || t.created_at,
    emergencyType: t.sos ? emergencyLabel(t.sos.alert_type) : `📋 ${t.subject}`,
    priority,
    vpiScore: Math.max(v.score, level ? level * 30 : 0),
    householdSize: t.sos?.headcount || people.length || 1,
    members: people.map(toPerson),
    landmark: [t.resident?.landmark, t.location_note].filter(Boolean).join(' • '),
    housePhotoPath: t.resident?.house_photo_path,
    houseType: t.resident?.household?.house_type,
    floorLevel: t.resident?.household?.floor_level,
    requiredGear: (t.equipment || []).length ? t.equipment.join(' • ') : v.gear,
    instructions: t.instructions,
    note: t.sos?.note,
    status: TICKET_STEP[t.status] || 'PENDING',
    sosActive: true,
    sosCancelled: t.sos?.status === 'cancelled',
    cancelReason: t.sos?.cancel_reason,
    verificationStatus: 'CONFIRMED',
    assignedUnit: myUnitName,
    lat_lng_key: `${t.sos?.created_at}|${t.sos?.alert_type}`,
    color: PRIORITY_COLOR[priority],
  };
}

function fromAlert(a, barangayNames) {
  const priority = a.alert_level === 3 ? 'CRITICAL' : a.alert_level === 2 ? 'ASSISTED' : 'LOW';
  const lat = Number(a.latitude);
  const lng = Number(a.longitude);
  return {
    id: `A-${a.alert_id}`,
    alertId: a.alert_id,
    isMine: false,
    name: a.resident_name,
    barangay: barangayNames[a.barangay_id] || '',
    sitio: a.visiting_from ? `visiting from Brgy. ${a.visiting_from}` : a.sitio || '',
    homeLat: lat,
    homeLng: lng,
    lat,
    lng,
    reportedAt: timeAgo(a.created_at),
    createdAt: a.created_at,
    emergencyType: emergencyLabel(a.alert_type),
    priority,
    vpiScore: a.alert_level * 30,
    householdSize: a.headcount,
    members: [],
    landmark: '',
    requiredGear: 'Waiting for the MDRRMO to assign a unit',
    status: 'QUEUED',
    sosActive: true,
    verificationStatus: a.ticket_status ? 'CONFIRMED' : 'UNVERIFIED',
    assignedUnit: a.ticket_status && a.ticket_status !== 'open' ? 'Another unit' : null,
    lat_lng_key: `${a.created_at}|${a.alert_type}`,
    color: PRIORITY_COLOR[priority],
  };
}

const FEED_CACHE_KEY = 'pc.rescuerFeed.v1';

async function readCachedFeed() {
  try {
    const raw = await AsyncStorage.getItem(FEED_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Turns the raw feed into what the screens use (the same for live and saved data).
function buildState(feed, barangays, reporters, savedAt, fromCache, unverifiedUids = []) {
  const unverified = new Set(unverifiedUids);
  const barangayNames = Object.fromEntries((barangays || []).map((b) => [b.barangay_id, b.barangay_name]));
  const who = reporters || {};
  const myUnitName = (feed.me?.units || []).map((u) => u.unit_name).join(', ') || 'My Unit';
  const mine = (feed.tickets || []).map((t) => fromTicket(t, myUnitName));
  const taken = new Set(mine.map((m) => m.lat_lng_key));
  const others = (feed.active_sos || []).filter((a) => !taken.has(`${a.created_at}|${a.alert_type}`))
    .map((a) => fromAlert(a, barangayNames));
  return {
    loading: false,
    error: null,
    me: { ...feed.me, unitLabel: myUnitName },
    // Unverified account (STEP26 trust level): details are self-reported, so the sheet says so.
    incidents: [...mine, ...others].map((i) => ({ ...i, accountUnverified: Boolean(i.residentUid && unverified.has(i.residentUid)) })),
    hazards: (feed.hazards || []).map((h) => ({
      ...toMapHazard(h),
      barangay: barangayNames[h.barangay_id] || '',
      reportedBy: reporterLabel(h.reporter_role, who[h.hazard_id]),
      reporterContact: who[h.hazard_id]?.contact_no || null,
      time: timeAgo(h.created_at),
      clearanceRequested: h.status === 'under_review' && /^cleared/i.test(h.review_note || ''),
    })).map((h) => ({
      ...h,
      // Under review = needs checking again, unless it is a clearance report waiting on the EOC.
      verificationStatus: h.clearanceRequested ? 'CONFIRMED' : h.status === 'under_review' ? 'UNVERIFIED' : h.verificationStatus,
    })),
    centers: (feed.centers || []).map((c) => ({ ...toMapShelter(c), raw: c })),
    events: feed.events || [],
    barangayNames,
    syncedAt: new Date(savedAt),
    fromCache,
  };
}

export function useRescuerFeed({ pollMs = 20000 } = {}) {
  const [state, setState] = useState({
    loading: true, error: null, me: null, incidents: [], hazards: [], centers: [], events: [], barangayNames: {}, syncedAt: null, fromCache: false,
  });

  const reload = useCallback(async () => {
    try {
      const [feed, barangays] = await Promise.all([getRescuerFeed(), listBarangays()]);
      const reporters = await getHazardReporters((feed.hazards || []).map((h) => h.hazard_id));
      const unverifiedUids = await getUnverifiedResidents((feed.tickets || []).map((t) => t.resident?.uid));
      const sosWith = await getTicketSosMembers((feed.tickets || []).map((t) => t.ticket_id));
      feed.tickets = (feed.tickets || []).map((t) => ({ ...t, sos_with: sosWith[t.ticket_id] || null }));
      const savedAt = new Date().toISOString();
      setState(buildState(feed, barangays, reporters, savedAt, false, unverifiedUids));
      // Keep a copy on the phone so the queue, resident details and hazards survive closing
      // the app and losing signal. Removed on sign-out.
      AsyncStorage.setItem(FEED_CACHE_KEY, JSON.stringify({ feed, barangays, reporters, savedAt, unverifiedUids })).catch(() => {});
    } catch (e) {
      // No signal: keep what is on screen, or fall back to the last saved copy.
      const cached = await readCachedFeed();
      setState((s) => (s.syncedAt
        ? { ...s, loading: false, error: e.message, fromCache: true }
        : cached
        ? { ...buildState(cached.feed, cached.barangays, cached.reporters, cached.savedAt, true, cached.unverifiedUids), error: e.message }
        : { ...s, loading: false, error: e.message }));
    }
  }, []);

  // Show the saved copy straight away while the live feed loads.
  useEffect(() => {
    readCachedFeed().then((cached) => {
      if (cached) setState((s) => (s.syncedAt ? s : { ...buildState(cached.feed, cached.barangays, cached.reporters, cached.savedAt, true, cached.unverifiedUids), loading: true }));
    });
  }, []);

  useEffect(() => {
    reload();
    const unsubscribe = subscribe(['sos_alerts', 'dispatch_tickets', 'hazard_reports', 'evacuation_records'], reload);
    // Disaster declarations, centres and unit changes come from the web console.
    const unsignal = onLiveSignal(['events', 'centers', 'units', 'missing', 'preemptive'], reload);
    const timer = setInterval(reload, pollMs);
    return () => { unsubscribe(); unsignal(); clearInterval(timer); };
  }, [reload, pollMs]);

  return { ...state, reload };
}

