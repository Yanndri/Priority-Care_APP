// Rescuer side, mounted once in the rescuer layout. Finds the unit's active
// mission and hands it to the shared GPS tracker, which then reports the unit's
// live position. Also tells the rescuer when they reach the resident.
import { useEffect } from 'react';
import { getRescuerFeed, subscribe } from '../services/api';
import { setTrackedMission, onProximityStage } from '../lib/rescueTracker';
import { notify } from '../lib/alarm';

// Most advanced first: a unit normally has one mission at a time.
const TRACKED = ['on_scene', 'en_route', 'acknowledged'];

const STAGE_TEXT = {
  approaching: (d) => ({ title: 'Approaching the resident', body: `About ${d} m to go.` }),
  nearby: (d) => ({ title: 'Resident very close', body: `About ${d} m away. Look for them.` }),
  critical: (d) => ({
    title: 'You have reached the resident',
    body: `GPS shows about ${d} m to the SOS point. Tap "Confirm arrival at resident" when you are with them.`,
    urgent: true,
  }),
};

export function MissionTracker() {
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const feed = await getRescuerFeed();
        const mission = (feed.tickets || [])
          .filter((t) => TRACKED.includes(t.status))
          .sort((a, b) => TRACKED.indexOf(a.status) - TRACKED.indexOf(b.status))[0];
        if (alive) setTrackedMission(mission?.ticket_id || null);
      } catch {
        // Offline: keep tracking the mission we already have.
      }
    };
    load();
    const unsubscribe = subscribe(['dispatch_tickets'], load);
    const timer = setInterval(load, 30000);
    const offStage = onProximityStage(({ ticketId, stage, distance_m: d }) => {
      const text = STAGE_TEXT[stage]?.(d ?? '?');
      if (text) notify({ ...text, data: { kind: 'mission', ticketId } });
    });
    return () => {
      alive = false;
      unsubscribe();
      clearInterval(timer);
      offStage();
      setTrackedMission(null); // signed out: stop reporting
    };
  }, []);
  return null;
}
