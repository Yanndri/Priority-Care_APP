// The offline map: one download of all of Cordova's map tiles (zoom 13 to 16, about
// 700 tiles, roughly 10 MB) into the phone's storage. The map uses them when there
// is no signal. Started and removed from the responder's Profile screen.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';

const INFO_KEY = 'pc.offlineMap.v1'; // { savedAt, tiles }
const BOUNDS = { minLat: 10.175, maxLat: 10.295, minLon: 123.895, maxLon: 124.02 }; // Cordova only; the map itself can pan around Metro Cebu online
const ZOOMS = [13, 14, 15, 16];
const BATCH = 6;

const lon2tile = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2tile = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

function cordovaTiles() {
  const tiles = [];
  ZOOMS.forEach((z) => {
    for (let x = lon2tile(BOUNDS.minLon, z); x <= lon2tile(BOUNDS.maxLon, z); x++) {
      for (let y = lat2tile(BOUNDS.maxLat, z); y <= lat2tile(BOUNDS.minLat, z); y++) tiles.push({ z, x, y });
    }
  });
  return tiles;
}

// null when nothing is saved yet.
export async function getOfflineMapInfo() {
  try { return JSON.parse((await AsyncStorage.getItem(INFO_KEY)) || 'null'); } catch { return null; }
}

// onProgress(done, total). Tiles already saved are skipped, so it doubles as "Update".
export async function downloadCordovaMap(onProgress = () => {}) {
  const tiles = cordovaTiles();
  let done = 0;
  let saved = 0;
  const getTile = async ({ z, x, y }) => {
    try {
      const dir = new Directory(Paths.document, 'tiles', String(z), String(x));
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      const file = new File(dir, `${y}.png`);
      if (!file.exists) {
        await File.downloadFileAsync(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, file, {
          idempotent: true,
          headers: { 'User-Agent': 'PriorityCare-Cordova/1.0' },
        });
      }
      saved++;
    } catch { /* one failed tile does not stop the rest */ }
    done++;
    onProgress(done, tiles.length);
  };
  for (let i = 0; i < tiles.length; i += BATCH) await Promise.all(tiles.slice(i, i + BATCH).map(getTile));
  const info = { savedAt: new Date().toISOString(), tiles: saved, total: tiles.length };
  await AsyncStorage.setItem(INFO_KEY, JSON.stringify(info));
  return info;
}

export async function removeOfflineMap() {
  const dir = new Directory(Paths.document, 'tiles');
  if (dir.exists) dir.delete();
  await AsyncStorage.removeItem(INFO_KEY);
}
