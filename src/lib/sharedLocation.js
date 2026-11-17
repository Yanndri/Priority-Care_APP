// The position the map screens are currently using (phone GPS or a demo location),
// shared so the nearby-hazard watcher checks from the same spot the user sees on the map.
let current = null;
const listeners = new Set();

export const getSharedLocation = () => current;

export function setSharedLocation(coords) {
  if (!coords || coords.lat == null || coords.lng == null) return;
  if (current && current.lat === coords.lat && current.lng === coords.lng) return;
  current = { lat: Number(coords.lat), lng: Number(coords.lng) };
  listeners.forEach((fn) => fn(current));
}

export function onSharedLocation(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// A demo location picked on a map (GPS simulator). Kept for the whole app session so moving
// between screens does not snap back to the phone's real GPS. Cleared when real GPS is chosen.
let demoSpot = null;
export const getDemoSpot = () => demoSpot;
export function setDemoSpot(coords) {
  demoSpot = coords && coords.lat != null ? { lat: Number(coords.lat), lng: Number(coords.lng) } : null;
}
