// Fixed choice lists used by the app's forms and screens (no sample data).

export const RESCUER_DEFAULT_COORDS = {
  lat: 10.2536,
  lng: 123.9512,
  callsign: 'RESCUER-ALPHA-01',
};

export const ID_TYPES = [
  { id: 'philsys', name: 'PhilSys National ID', desc: 'Printed PVC, paper ePhilID, or digital' },
  { id: 'brgy', name: 'Barangay Resident Certificate / ID', desc: 'Issued by Barangay Hall with official seal' },
  { id: 'senior', name: 'OSCA Senior Citizen ID', desc: 'Office of Senior Citizens Affairs card' },
  { id: 'pwd', name: 'PWD Identification Card', desc: 'Issued by MSWD' },
  { id: 'voters', name: 'COMELEC Voter’s Certificate / ID', desc: 'Registered Cordova voter record' },
  { id: '4ps', name: '4Ps DSWD Pantawid Card', desc: 'Household beneficiary credential' },
];

export const RESIDENT_CATEGORIES = [
  { id: 'adult', label: '🧑 Adult' },
  { id: 'child', label: '👶 Child (<12)' },
  { id: 'senior', label: '🧓 Senior (60+)' },
  { id: 'pregnant', label: '🤰 Pregnant' },
];

export const RESIDENT_MOBILITIES = [
  { id: 'ambulatory', label: '🚶 Independent' },
  { id: 'semi', label: '🦯 Assisted' },
  { id: 'wheelchair', label: '♿ Wheelchair (PWD)' },
  { id: 'non', label: '🦽 Bedridden' },
];

export const HOUSE_TYPES = [
  { id: 'concrete', label: '🏢 Concrete' },
  { id: 'mixed', label: '🏠 Mixed' },
  { id: 'light', label: '🛖 Light / Wood' },
];

export const EMERGENCY_TYPES = [
  { id: 'FLOOD', label: 'Rising Flood', icon: '🌊' },
  { id: 'FIRE', label: 'Fire Hazard', icon: '🔥' },
  { id: 'MEDICAL', label: 'Medical Crisis', icon: '🚑' },
  { id: 'TRAPPED', label: 'Trapped / Debris', icon: '🏚️' },
];

export const HAZARD_OPTIONS = [
  { id: 'FIRE', label: 'Conflagration / Fire', icon: '🔥' },
  { id: 'FLOOD', label: 'Flash Flood / Surge', icon: '🌊' },
  { id: 'BLOCK', label: 'Blocked Alley / Debris', icon: '🚧' },
  { id: 'WIRE', label: 'Live Electrical Wire', icon: '⚡' },
  { id: 'LANDSLIDE', label: 'Landslide / Soil Movement', icon: '⛰️' },
  { id: 'OTHER', label: 'Other Hazard', icon: '⚠️' },
];

