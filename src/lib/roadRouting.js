// Road distances from one point to many evacuation centers, using the same
// public OSRM router the map already draws routes with (one "table" request).
// Falls back to straight-line distance when the router can't be reached; the
// result says which was used so the screen can tell the rescuer.
import { distanceMeters } from './location';

const OSRM = 'https://router.project-osrm.org';
const TIMEOUT_MS = 8000;

// from: { lat, lng }; centers: [{ center_id, latitude, longitude, ... }]
// Returns { byRoad: boolean, centers: [{ ...center, road_m, road_s, straight_m }] } nearest first.
export async function rankCentersByRoad(from, centers) {
  const list = centers
    .filter((c) => c.latitude != null && c.longitude != null)
    .map((c) => ({ ...c, straight_m: distanceMeters(from, { lat: Number(c.latitude), lng: Number(c.longitude) }) }));
  if (!list.length) return { byRoad: false, centers: [] };

  // The router accepts up to 100 points; keep the 60 closest in a straight line.
  const shortlist = [...list].sort((a, b) => a.straight_m - b.straight_m).slice(0, 60);
  const coords = [`${from.lng},${from.lat}`, ...shortlist.map((c) => `${Number(c.longitude)},${Number(c.latitude)}`)].join(';');
  const url = `${OSRM}/table/v1/driving/${coords}?sources=0&annotations=distance,duration`;

  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, ctrl ? { signal: ctrl.signal } : {});
    if (!res.ok) throw new Error(`router ${res.status}`);
    const j = await res.json();
    if (j.code !== 'Ok' || !j.distances?.[0]) throw new Error('router gave no table');
    const dist = j.distances[0];
    const dur = j.durations?.[0] || [];
    const ranked = shortlist.map((c, i) => ({ ...c, road_m: dist[i + 1], road_s: dur[i + 1] }));
    // Centers the road network can't reach go last, by straight line.
    ranked.sort((a, b) => (a.road_m == null) - (b.road_m == null) || (a.road_m ?? a.straight_m) - (b.road_m ?? b.straight_m));
    return { byRoad: true, centers: ranked };
  } catch {
    return { byRoad: false, centers: [...list].sort((a, b) => a.straight_m - b.straight_m) };
  } finally {
    clearTimeout(timer);
  }
}
