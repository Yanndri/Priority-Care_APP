// "Do you see it too?" Mounted once per portal (residents and responders). When someone else
// pins a hazard within 10 km of you, a prompt pops up on whatever screen is open. Saying yes
// raises the hazard's alarm level (2nd / 3rd alarm) on the admin's web console.
// Works only while the app is open: Expo Go has no push notifications.
import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { confirmHazard, getNearbyHazards, onLiveSignal, unconfirmHazard } from '../services/api';
import { getCurrentCoords } from '../lib/location';
import { getSharedLocation, onSharedLocation } from '../lib/sharedLocation';
import { HAZARD_ICONS } from '../lib/mapData';

const TYPE_LABEL = { FIRE: 'Fire', FLOOD: 'Flood', BLOCK: 'Blocked road', WIRE: 'Live wire', LANDSLIDE: 'Landslide', OTHER: 'Hazard' };

export default function NearbyHazardWatcher({ enabled = true }) {
  const asked = useRef(new Set()); // hazards already prompted in this app session
  const open = useRef(false); // one prompt at a time

  const check = useCallback(async () => {
    if (!enabled || open.current) return;
    const here = getSharedLocation() || (await getCurrentCoords());
    if (!here) return;
    let rows;
    try { rows = (await getNearbyHazards(here)) || []; } catch { return; } // offline or STEP20 not run
    const next = rows.find((h) => !h.confirmed_by_me && !asked.current.has(h.hazard_id));
    if (!next) return;
    asked.current.add(next.hazard_id);
    open.current = true;
    const done = () => { open.current = false; };
    Alert.alert(
      `${HAZARD_ICONS[next.hazard_type] || '⚠️'} ${TYPE_LABEL[next.hazard_type] || 'Hazard'} reported ${next.distance_m} m from you`,
      `${next.description ? `"${next.description}"\n\n` : ''}Do you see it too? Only say yes if you can see it from where you are.`,
      [
        { text: 'Not sure', style: 'cancel', onPress: done },
        {
          text: 'I see it too',
          onPress: async () => {
            try {
              await confirmHazard(next.hazard_id, here);
              Alert.alert('Thank you ✅', 'Your confirmation was sent to the barangay. Pressed it by mistake? Take it back.', [
                {
                  text: 'Take it back',
                  onPress: async () => {
                    try { await unconfirmHazard(next.hazard_id); } catch { /* STEP23 not run: keep it */ }
                    done();
                  },
                },
                { text: 'OK', onPress: done },
              ]);
            } catch (e) {
              Alert.alert('Not sent', e.message, [{ text: 'OK', onPress: done }]);
            }
          },
        },
      ],
      { cancelable: true, onDismiss: done },
    );
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    check();
    const unsignal = onLiveSignal(['hazards'], check);
    const unmove = onSharedLocation(check);
    const timer = setInterval(check, 60000);
    return () => { unsignal(); unmove(); clearInterval(timer); };
  }, [check, enabled]);

  return null;
}
