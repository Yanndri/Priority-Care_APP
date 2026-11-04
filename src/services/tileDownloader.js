import { Directory, File, Paths } from 'expo-file-system';

// Slippy Map math helpers
export function lon2tile(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

export function lat2tile(lat, zoom) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, zoom)
  );
}

// Bounding box for Cordova, Cebu
export const CORDOVA_BOUNDS = {
  minLat: 10.2300,
  maxLat: 10.2750,
  minLon: 123.9300,
  maxLon: 123.9700,
};

// Check if cached tiles directory exists
export function checkTilesExist() {
  const tilesDir = new Directory(Paths.document, 'tiles');
  return tilesDir.exists;
}

// Shared core download engine
async function downloadTileBatch(tilesToDownload, onProgress = () => {}) {
  const total = tilesToDownload.length;
  if (total === 0) {
    onProgress(100, 0, 0);
    return true;
  }

  let completed = 0;
  const BATCH_SIZE = 6;

  async function downloadTile(tile) {
    const { z, x, y } = tile;
    const dir = new Directory(Paths.document, 'tiles', String(z), String(x));
    const localFile = new File(dir, `${y}.png`);

    try {
      if (!dir.exists) {
        dir.create({ intermediates: true });
      }

      if (!localFile.exists) {
        const remoteUrl = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
        await File.downloadFileAsync(remoteUrl, localFile, {
          headers: {
            'User-Agent': 'PriorityCare-LGU-DisasterApp/1.0',
          },
        });
      }
    } catch (e) {
      console.warn(`Tile download error ${z}/${x}/${y}:`, e);
    } finally {
      completed++;
      onProgress(Math.round((completed / total) * 100), completed, total);
    }
  }

  for (let i = 0; i < tilesToDownload.length; i += BATCH_SIZE) {
    const batch = tilesToDownload.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map((t) => downloadTile(t)));
  }

  return true;
}

/**
 * Downloads alleyway-level tiles (Zooms 14-17) for a specific clicked barangay
 * @param {Object} bounds { minLat, maxLat, minLon, maxLon }
 * @param {Function} onProgress callback (percentage, completed, total)
 */
export async function downloadBarangayTiles(bounds, onProgress = () => {}) {
  const minZoom = 14;
  const maxZoom = 17; // Street and alleyway tactical level
  const tilesToDownload = [];

  for (let z = minZoom; z <= maxZoom; z++) {
    const leftX = lon2tile(bounds.minLon, z);
    const rightX = lon2tile(bounds.maxLon, z);
    const topY = lat2tile(bounds.maxLat, z);
    const bottomY = lat2tile(bounds.minLat, z);

    for (let x = Math.min(leftX, rightX); x <= Math.max(leftX, rightX); x++) {
      for (let y = Math.min(topY, bottomY); y <= Math.max(topY, bottomY); y++) {
        tilesToDownload.push({ z, x, y });
      }
    }
  }

  return await downloadTileBatch(tilesToDownload, onProgress);
}

// Full municipal tile downloader (Zooms 13-15 overview)
export async function downloadCordovaTiles(onProgress = () => {}) {
  const bounds = CORDOVA_BOUNDS;
  const minZoom = 13;
  const maxZoom = 15;
  const tilesToDownload = [];

  for (let z = minZoom; z <= maxZoom; z++) {
    const leftX = lon2tile(bounds.minLon, z);
    const rightX = lon2tile(bounds.maxLon, z);
    const topY = lat2tile(bounds.maxLat, z);
    const bottomY = lat2tile(bounds.minLat, z);

    for (let x = leftX; x <= rightX; x++) {
      for (let y = topY; y <= bottomY; y++) {
        tilesToDownload.push({ z, x, y });
      }
    }
  }

  return await downloadTileBatch(tilesToDownload, onProgress);
}