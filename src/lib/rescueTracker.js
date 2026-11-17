// The responder's own GPS position, only while the map screen is open (to save
// battery). Nothing is sent to the server: residents get status updates
// ("on the way", "arrived", ...) instead of a live position.
import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

// A fix older than this is shown as "signal lost".
export const GPS_STALE_MS = 30000;

export function useTracker({ active = true } = {}) {
  const [s, setS] = useState({ permission: 'unknown', servicesOn: true, fix: null });
  useEffect(() => {
    if (!active) return undefined;
    let sub = null;
    let alive = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (!alive) return;
        if (status !== 'granted') { setS((p) => ({ ...p, permission: 'denied' })); return; }
        const on = await Location.hasServicesEnabledAsync().catch(() => true);
        setS((p) => ({ ...p, permission: 'granted', servicesOn: on }));
        if (!on) return;
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 10 },
          (pos) => setS((p) => ({
            ...p,
            fix: {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : null,
              at: new Date(pos.timestamp || Date.now()),
            },
          })),
        );
        if (!alive) sub.remove();
      } catch { /* no GPS: the map keeps the last position */ }
    })();
    return () => { alive = false; sub?.remove(); };
  }, [active]);
  return s;
}
