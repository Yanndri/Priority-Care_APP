// Is a point inside Cordova? Uses the barangay borders (same file as the map).
// Ray casting: a line going right from the point crosses the outline an odd
// number of times when the point is inside.
import borders from '../constants/cordova-borders.json';

function insideRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// First ring is the outline; later rings are holes.
function insidePolygon(lat, lng, rings) {
  if (!rings.length || !insideRing(lat, lng, rings[0])) return false;
  return !rings.slice(1).some((hole) => insideRing(lat, lng, hole));
}

export function barangayAt(lat, lng) {
  const hit = borders.features.find(({ geometry: g }) =>
    g.type === 'Polygon'
      ? insidePolygon(lat, lng, g.coordinates)
      : g.coordinates.some((poly) => insidePolygon(lat, lng, poly)));
  return hit ? hit.properties.name : null;
}

export const isInCordova = (lat, lng) => barangayAt(lat, lng) !== null;

export const OUTSIDE_CORDOVA_MESSAGE = 'That spot is outside Cordova. Hazards can only be reported inside the municipality.';
