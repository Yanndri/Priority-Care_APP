// Converts database rows into the shapes the map (components/offlineMap) draws.
import { HAZARD_OPTIONS } from '../constants/mockData';

export const HAZARD_ICONS = Object.fromEntries(HAZARD_OPTIONS.map((h) => [h.id, h.icon]));

export const toMapHazard = (h) => ({
  id: h.hazard_id,
  type: h.hazard_type,
  icon: HAZARD_ICONS[h.hazard_type] || '⚠️',
  description: h.description,
  lat: Number(h.latitude),
  lng: Number(h.longitude),
  barangayId: h.barangay_id,
  status: h.status || 'confirmed',
  verificationStatus: (h.status || 'confirmed').toUpperCase(),
  reporterRole: h.reporter_role,
  photoPath: h.photo_path,
  reviewNote: h.review_note,
  createdAt: h.created_at,
  eventId: h.event_id || null, // set when the report is part of a declared disaster (STEP21)
});

export const toMapShelter = (c) => ({
  id: c.center_id,
  name: c.center_name,
  lat: Number(c.latitude),
  lng: Number(c.longitude),
  occupied: Number(c.occupied) || 0,
  capacity: Number(c.capacity) || 0,
});

const CENTER_TYPE_LABELS = {
  school: 'School', covered_court: 'Covered court', barangay_hall: 'Barangay hall', church: 'Church',
  makeshift: 'Temporary shelter', other: 'Evacuation centre',
};
export const centerTypeLabel = (type) => (type ? CENTER_TYPE_LABELS[type] || type.replace(/_/g, ' ') : null);
