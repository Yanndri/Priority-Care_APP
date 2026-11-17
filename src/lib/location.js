// Device position helpers. Every function returns null instead of throwing
// when permission is refused or no fix is available.
import * as Location from 'expo-location';

export async function getCurrentCoords({ precise = false } = {}) {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    if (!precise) {
      const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 });
      if (last) return { lat: last.coords.latitude, lng: last.coords.longitude };
    }
    const fix = await Location.getCurrentPositionAsync({
      accuracy: precise ? Location.Accuracy.High : Location.Accuracy.Balanced,
    });
    return { lat: fix.coords.latitude, lng: fix.coords.longitude };
  } catch {
    return null;
  }
}

// Follows the phone while it moves. Calls onChange({ lat, lng }) every time it
// moves about 10 m (or every 5 s). Returns a function that stops watching.
export function watchCoords(onChange) {
  let sub = null;
  let stopped = false;
  (async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || stopped) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 10, timeInterval: 5000 },
        (pos) => onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      );
      if (stopped) sub.remove();
    } catch {
      // No location: the map keeps the last known position.
    }
  })();
  return () => {
    stopped = true;
    if (sub) sub.remove();
  };
}

// One precise reading with its accuracy, for pinning the home. Returns
// { lat, lng, accuracy, fromCache } or { error: 'denied' | 'services_off' | 'no_fix', canAskAgain }.
export async function getLocationFix({ timeoutMs = 15000 } = {}) {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return { error: 'denied', canAskAgain: perm.canAskAgain !== false };
    if (!(await Location.hasServicesEnabledAsync())) return { error: 'services_off' };
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    const pos = fresh || (await Location.getLastKnownPositionAsync({ maxAge: 2 * 60 * 1000 }).catch(() => null));
    if (!pos) return { error: 'no_fix' };
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : null,
      fromCache: !fresh,
    };
  } catch {
    return { error: 'no_fix' };
  }
}

// Straight-line distance in metres; null when either point is missing.
export function distanceMeters(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const R = 6371e3;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

export const formatDistance = (m) => (m == null ? '' : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);

// Occupancy colour and label used by every shelter card.
export function shelterLoad(center) {
  const capacity = Number(center.capacity) || 0;
  const occupied = Number(center.occupied) || 0;
  const percent = capacity ? Math.min(100, Math.round((occupied / capacity) * 100)) : 0;
  if (percent >= 100) return { percent, label: 'FULL', color: '#DC2626' };
  if (percent >= 80) return { percent, label: 'NEAR CAPACITY', color: '#D97706' };
  return { percent, label: 'OPEN', color: '#16A34A' };
}
