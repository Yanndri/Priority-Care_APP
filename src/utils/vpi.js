import { COLORS } from '../constants/colors';

export function calculateVPI({
  semiCount = 0,
  nonAmbulatoryCount = 0,
  childrenCount = 0,
  seniorsCount = 0,
  pregnantCount = 0,
  houseType = 'concrete',
} = {}) {
  let score = 0;
  const nonAmb = parseInt(nonAmbulatoryCount, 10) || 0;
  const semi = parseInt(semiCount, 10) || 0;
  const preg = parseInt(pregnantCount, 10) || 0;
  const child = parseInt(childrenCount, 10) || 0;
  const senior = parseInt(seniorsCount, 10) || 0;

  if (nonAmb > 0) score += Math.min(30 + (nonAmb - 1) * 5, 40);
  else if (semi > 0) score += Math.min(18 + (semi - 1) * 4, 26);

  let depScore = (preg > 0 ? 18 : 0) + Math.min(child * 8, 16) + Math.min(senior * 6, 12);
  score += Math.min(depScore, 35);

  if (houseType === 'light') score += 25;
  else if (houseType === 'mixed') score += 12;

  return Math.min(Math.round(score), 100);
}

export function getVPIPriority(score = 0) {
  if (score >= 70) return 'CRITICAL';
  if (score >= 40) return 'ASSISTED';
  return 'LOW';
}

export function determineRequiredGear({ nonAmbulatoryCount = 0, semiCount = 0, pregnantCount = 0, childrenCount = 0 } = {}) {
  const gear = [];
  if (parseInt(nonAmbulatoryCount, 10) > 0) gear.push('Long Spine Board (LSB) + 4-Man Team');
  else if (parseInt(semiCount, 10) > 0) gear.push('Transit Wheelchair');
  else gear.push('Standard Guided Escort');

  if (parseInt(pregnantCount, 10) > 0) gear.push('Maternal Emergency Pack');
  if (parseInt(childrenCount, 10) > 0) gear.push('Child Float Vest');
  return gear.join(' • ');
}

export function getVPITheme(priority) {
  if (priority === 'CRITICAL') return { color: COLORS.danger, label: 'CRITICAL' };
  if (priority === 'ASSISTED') return { color: COLORS.warning, label: 'ASSISTED' };
  return { color: COLORS.success, label: 'LOW' };
}

export function sortResidentsByVPI(list = []) {
  return [...list].sort((a, b) => (b.vpiScore || 0) - (a.vpiScore || 0));
}