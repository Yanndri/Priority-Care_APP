// One shared GPS watcher for the rescuer. The map and the mission tracker both
// use it, so the phone never runs two location watchers at once.
//
// While a mission is active every fix is queued and sent to report_unit_location
// in small batches. If the phone is offline the fixes wait in AsyncStorage and are
// sent together when the connection comes back (the server keeps the newest one
// as the live position and still records the rest in the trail).
//
// Only real device fixes are ever sent. Nothing here accepts simulated coordinates.
import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportUnitLocation } from '../services/api';

const QUEUE_KEY = 'pc.rescue.gpsQueue.v1';
const MAX_QUEUE = 400;          // about 25 minutes of fixes at one every 4 s
const MIN_GAP_MS = 4000;        // at most one queued fix per 4 s
const FLUSH_MS = 5000;          // one database call at most every 5 s
const RETRY_MS = 15000;         // after a failed send, retry this often
const BATCH = 200;

let state = {
  permission: 'unknown',  // unknown | granted | denied
  servicesOn: true,       // phone location switched on
  fix: null,              // { lat, lng, accuracy, heading, speed, at }
  ticketId: null,         // mission being tracked
  online: true,           // last send worked
  queued: 0,              // fixes waiting to be sent
  lastSentAt: null,       // Date of the last successful send
  server: null,           // last report_unit_location reply
};
const listeners = new Set();
const stageListeners = new Set();
let users = 0;
let watch = null;
let starting = false;
let queue = [];          // [{ ticketId, point }]
let loaded = false;
let lastQueuedAt = 0;
let flushTimer = null;
let flushing = false;
let nextFlushAt = 0;
let servicesTimer = null;

function emit(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

export const getTrackerState = () => state;

export function onTrackerChange(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

// fn({ ticketId, stage, distance_m }) when the server moves the mission to a new proximity stage.
export function onProximityStage(fn) {
  stageListeners.add(fn);
  return () => stageListeners.delete(fn);
}

async function loadQueue() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const saved = raw ? JSON.parse(raw) : [];
    if (Array.isArray(saved)) queue = [...saved, ...queue].slice(-MAX_QUEUE);
  } catch { /* storage unavailable: queue stays in memory */ }
  emit({ queued: queue.length });
}

function saveQueue() {
  AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue)).catch(() => {});
}

function scheduleFlush(delay) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, Math.max(0, delay));
}

async function flush() {
  if (flushing || !queue.length) return;
  flushing = true;
  try {
    // Oldest mission first; points of a finished mission are dropped by the server reply.
    const ticketId = queue[0].ticketId;
    const batch = queue.filter((q) => q.ticketId === ticketId).slice(0, BATCH);
    const reply = await reportUnitLocation(ticketId, batch.map((q) => q.point));
    const sent = new Set(batch);
    queue = reply?.mission_active === false
      ? queue.filter((q) => q.ticketId !== ticketId)      // mission closed: nothing more to send for it
      : queue.filter((q) => !sent.has(q));
    saveQueue();
    emit({ online: true, lastSentAt: new Date(), queued: queue.length, server: { ...reply, ticketId } });
    if (reply?.stage_changed && reply.proximity_stage) {
      stageListeners.forEach((fn) => fn({ ticketId, stage: reply.proximity_stage, distance_m: reply.distance_m }));
    }
    if (reply?.mission_active === false && state.ticketId === ticketId) {
      emit({ ticketId: null });
      stopIfIdle();
    }
    nextFlushAt = Date.now() + FLUSH_MS;
    if (queue.length) scheduleFlush(queue.length > BATCH ? 0 : FLUSH_MS);
  } catch {
    // Offline or the server refused: keep the fixes and try again later.
    emit({ online: false, queued: queue.length });
    nextFlushAt = Date.now() + RETRY_MS;
    scheduleFlush(RETRY_MS);
  } finally {
    flushing = false;
  }
}

function onFix(pos) {
  const c = pos.coords;
  const fix = {
    lat: c.latitude,
    lng: c.longitude,
    accuracy: c.accuracy != null ? Math.round(c.accuracy) : null,
    heading: c.heading != null && c.heading >= 0 ? Math.round(c.heading) : null,
    speed: c.speed != null && c.speed >= 0 ? c.speed : null,
    at: new Date(pos.timestamp || Date.now()),
  };
  emit({ fix, servicesOn: true });
  if (!state.ticketId) return;
  const now = Date.now();
  if (now - lastQueuedAt < MIN_GAP_MS) return;
  lastQueuedAt = now;
  queue.push({
    ticketId: state.ticketId,
    point: {
      lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, heading: fix.heading, speed: fix.speed,
      recorded_at: fix.at.toISOString(),
    },
  });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  saveQueue();
  emit({ queued: queue.length });
  if (!flushing) scheduleFlush(nextFlushAt - now);
}

async function checkServices() {
  try {
    const on = await Location.hasServicesEnabledAsync();
    if (on !== state.servicesOn) emit({ servicesOn: on });
    if (on && !watch && !starting && (users > 0 || state.ticketId)) start();
  } catch { /* ignore */ }
}

async function start() {
  if (watch || starting) return;
  starting = true;
  try {
    await loadQueue();
    const { status } = await Location.requestForegroundPermissionsAsync();
    emit({ permission: status === 'granted' ? 'granted' : 'denied' });
    if (status !== 'granted') return;
    const on = await Location.hasServicesEnabledAsync().catch(() => true);
    emit({ servicesOn: on });
    if (!on) return;
    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 0 },
      onFix,
    );
    if (users > 0 || state.ticketId) watch = sub;
    else sub.remove();
  } catch {
    // Location failed to start; checkServices tries again.
  } finally {
    starting = false;
    if (queue.length) scheduleFlush(0);
  }
}

function stopIfIdle() {
  if (users > 0 || state.ticketId) return;
  if (watch) { watch.remove(); watch = null; }
  clearInterval(servicesTimer);
  servicesTimer = null;
}

function ensureRunning() {
  start();
  if (!servicesTimer) servicesTimer = setInterval(checkServices, 10000);
}

// A screen that shows the rescuer's position calls this; the release stops the
// watcher once nothing else needs it.
export function acquireTracker() {
  users += 1;
  ensureRunning();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users = Math.max(0, users - 1);
    stopIfIdle();
  };
}

// The mission whose position is reported (null when the unit has no active mission).
export function setTrackedMission(ticketId) {
  const id = ticketId || null;
  if (id === state.ticketId) {
    if (!id) stopIfIdle();
    return;
  }
  emit({ ticketId: id, server: id && state.server?.ticketId === id ? state.server : null });
  if (id) {
    ensureRunning();
    loadQueue().then(() => queue.length && scheduleFlush(0));
  } else {
    stopIfIdle();
  }
}

// Sends whatever is waiting right now (e.g. before confirming the resident is found).
export function flushNow() {
  scheduleFlush(0);
}

export function useTracker({ active = true } = {}) {
  const [s, setS] = useState(state);
  useEffect(() => {
    const off = onTrackerChange(setS);
    const release = active ? acquireTracker() : null;
    return () => { off(); if (release) release(); };
  }, [active]);
  return s;
}

// "Live" while fixes keep coming; the map greys the marker out after this.
export const GPS_STALE_MS = 30000;
