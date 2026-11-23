// Free spaces at each open evacuation center, from get_center_availability:
// free = capacity - people sheltered there - seats reserved for households a rescuer is bringing in.
// The same numbers the server uses when it accepts a walk-in or reserves a seat.
import { useCallback, useEffect, useState } from 'react';
import { getCenterAvailability, onLiveSignal } from '../services/api';

export function useCenterAvailability({ enabled = true, pollMs = 30000 } = {}) {
  const [byId, setById] = useState({});
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await getCenterAvailability();
      const next = {};
      for (const c of res?.centers || []) {
        next[c.center_id] = {
          capacity: Number(c.capacity) || 0,
          occupied: Number(c.occupied) || 0,
          reserved: Number(c.reserved) || 0,
          available: Number(c.available) || 0,
        };
      }
      setById(next);
      setLoaded(true);
    } catch {
      // Offline: keep the last numbers on screen.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    reload();
    const unsignal = onLiveSignal(['centers', 'evacuation', 'preemptive'], reload);
    const timer = setInterval(reload, pollMs);
    return () => { unsignal(); clearInterval(timer); };
  }, [enabled, pollMs, reload]);

  return { byId, loaded, reload };
}

// Short label for a center's room, e.g. "12 of 60 spaces free" or "Full".
export function freeLabel(a) {
  if (!a) return null;
  if (a.available <= 0) return 'Full';
  return `${a.available} of ${a.capacity} space${a.capacity === 1 ? '' : 's'} free`;
}
