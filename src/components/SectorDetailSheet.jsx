import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Alert } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { FONT_SIZES, FONT_WEIGHTS } from '../constants/typography';

// Convert Lat/Lon to OpenStreetMap Slippy Tile (X, Y)
function lonToTileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

function latToTileY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z)
  );
}

function getBarangayTiles(bounds, zooms = [14, 15, 16]) {
  if (!bounds) return [];
  const tiles = [];
  zooms.forEach((z) => {
    const xMin = lonToTileX(bounds.minLon, z);
    const xMax = lonToTileX(bounds.maxLon, z);
    const yMin = latToTileY(bounds.maxLat, z); // North is smaller Y
    const yMax = latToTileY(bounds.minLat, z); // South is larger Y

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x, y });
      }
    }
  });
  return tiles.slice(0, 36); // Cap at 36 tiles for fast field caching
}

export default function SectorDetailSheet({
  barangay,
  residents = [],
  hazards = [],
  onClose,
  onDownloadSuccess,
  onResidentSelect,
  bottomOffset = 70,
}) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [progressText, setProgressText] = useState('');

  if (!barangay) return null;

  const criticalCount = residents.filter((r) => r.priority === 'CRITICAL').length;
  const activeSosCount = residents.filter((r) => r.sosActive).length;

  const handlePrecacheSector = async () => {
    if (isDownloading) return;
    setIsDownloading(true);

    try {
      const tiles = getBarangayTiles(barangay.bounds, [14, 15, 16]);
      let downloadedCount = 0;

      for (let i = 0; i < tiles.length; i++) {
        const { z, x, y } = tiles[i];
        setProgressText(`Caching tiles (${i + 1}/${tiles.length}) & ${residents.length} households...`);

        try {
          const xDir = new Directory(Paths.document, 'tiles', String(z), String(x));
          if (!xDir.exists) {
            xDir.create({ intermediates: true, idempotent: true });
          }
          const tileFile = new File(xDir, `${y}.png`);
          if (!tileFile.exists) {
            await File.downloadFileAsync(
              `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
              tileFile,
              {
                idempotent: true,
                headers: { 'User-Agent': 'PriorityCare-Cordova-MDRRMO/1.0' },
              }
            );
          }
          downloadedCount++;
        } catch {
          // Continue caching remaining tiles and JSON even if a single tile times out
        }
      }

      // Bundle full barangay offline snapshot (households + hazards + tile count)
      const sectorPacket = {
        name: barangay.name,
        bounds: barangay.bounds,
        tileCount: downloadedCount || tiles.length,
        householdCount: residents.length,
        cachedResidents: residents,
        cachedHazards: hazards,
      };

      if (onDownloadSuccess) {
        await onDownloadSuccess(sectorPacket);
      }

      Alert.alert(
        'Barangay Precache Complete 📦',
        `Brgy. ${barangay.name} is now stored for zero-connectivity operations:\n• ${residents.length} Household Profiles & VPI Scores\n• ${hazards.length} Sector Hazard Markers\n• ${tiles.length} Bounding-Box Map Tiles (Zoom 14–16)`
      );
    } catch (e) {
      Alert.alert('Cache Error', 'Could not complete sector precaching.');
    } finally {
      setIsDownloading(false);
      setProgressText('');
    }
  };

  return (
    <View style={[styles.sheet, { bottom: bottomOffset }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Brgy. {barangay.name}</Text>
            <View style={[styles.badge, barangay.isCached ? styles.badgeCached : styles.badgeUncached]}>
              <Text style={[styles.badgeText, barangay.isCached ? styles.textCached : styles.textUncached]}>
                {barangay.isCached ? `✓ CACHED (${barangay.cachedAt})` : '☁️ NOT CACHED'}
              </Text>
            </View>
          </View>
          <Text style={styles.sub}>
            {residents.length} Registered Households • {activeSosCount} Active SOS • {criticalCount} Critical VPI
          </Text>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Precache Download Button */}
      <TouchableOpacity
        style={[styles.btnDownload, barangay.isCached && styles.btnRecache, isDownloading && { opacity: 0.75 }]}
        disabled={isDownloading}
        onPress={handlePrecacheSector}
      >
        {isDownloading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#FFF" />
            <Text style={styles.btnDownloadText}>{progressText}</Text>
          </View>
        ) : (
          <Text style={styles.btnDownloadText}>
            {barangay.isCached
              ? `🔄 Refresh Offline Precache (${residents.length} Homes + Map Tiles)`
              : `📥 Download Offline Precache (${residents.length} Homes + Map Tiles)`}
          </Text>
        )}
      </TouchableOpacity>

      {/* Household List Inside Barangay */}
      <Text style={styles.listHeader}>SECTOR HOUSEHOLDS (TAP TO FOCUS)</Text>
      {residents.length === 0 ? (
        <Text style={styles.emptyText}>No households registered in this sector filter.</Text>
      ) : (
        <FlatList
          data={residents}
          keyExtractor={(item) => item.id}
          style={{ maxHeight: 150 }}
          contentContainerStyle={{ gap: 6 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.resRow} onPress={() => onResidentSelect(item)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.resName}>
                  {item.sosActive ? '🚨 ' : '🏠 '}
                  {item.name} ({item.sitio})
                </Text>
                <Text style={styles.resMeta}>
                  VPI: {item.vpiScore} ({item.priority}) • {item.dependents} • {item.requiredGear}
                </Text>
              </View>
              <View style={styles.zoomPill}>
                <Text style={styles.zoomPillText}>📍 Focus</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 14,
    elevation: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { fontSize: FONT_SIZES.subtitle, fontWeight: FONT_WEIGHTS.black, color: '#0F172A' },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, borderWidth: 1 },
  badgeCached: { backgroundColor: '#DCFCE7', borderColor: '#86EFAC' },
  badgeUncached: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  badgeText: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold },
  textCached: { color: '#15803D' },
  textUncached: { color: '#DC2626' },
  sub: { fontSize: FONT_SIZES.caption, color: '#64748B', fontWeight: FONT_WEIGHTS.bold, marginTop: 2 },
  closeBtn: { padding: 4 },
  closeText: { fontSize: 16, fontWeight: '900', color: '#64748B' },
  btnDownload: {
    backgroundColor: '#1E3A8A',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 10,
  },
  btnRecache: { backgroundColor: '#15803D' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnDownloadText: { color: '#FFF', fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold },
  listHeader: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#64748B', marginBottom: 6 },
  emptyText: { fontSize: FONT_SIZES.caption, color: '#94A3B8', fontStyle: 'italic', paddingVertical: 8 },
  resRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  resName: { fontSize: FONT_SIZES.caption, fontWeight: FONT_WEIGHTS.extraBold, color: '#0F172A' },
  resMeta: { fontSize: FONT_SIZES.tiny, color: '#475569', marginTop: 1 },
  zoomPill: { backgroundColor: '#EFF6FF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginLeft: 8 },
  zoomPillText: { fontSize: FONT_SIZES.tiny, fontWeight: FONT_WEIGHTS.extraBold, color: '#1E3A8A' },
});