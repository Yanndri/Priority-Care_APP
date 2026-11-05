import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Paths } from 'expo-file-system';
import rawGeoJSON from '../constants/cordova-barangays.json';

export default function OfflineMap({
  residents = [],
  hazards = [],
  shelters = [],
  gpsLabel = 'My Unit',
  cachedSectors = {},
  isOffline = false,
  isDroppingHazard = false,
  isSettingSimGps = false,
  gpsMode = 'SIMULATED',
  role = 'rescuer',
  userGpsCoords = null,
  triggerGpsQuery = 0,
  selectedBarangay = null,
  selectedResident = null,
  selectedHazardPin = null,
  onPinSelect,
  onHazardPinSelect,
  onBarangaySelect,
  onMapClick,
  onHazardCoordinateDrop,
  onSimGpsCoordinateDrop,
  onGpsLocationFound,
  onGpsLocationError,
}) {
  const webViewRef = useRef(null);

  const pushStateToWebView = useCallback(() => {
    if (!webViewRef.current) return;

    webViewRef.current.injectJavaScript(`
      if (typeof window.syncCachedSectors === 'function') {
        window.syncCachedSectors(${JSON.stringify(cachedSectors)});
      }
      if (typeof window.syncDropModes === 'function') {
        window.syncDropModes(
          ${JSON.stringify(hazards)},
          ${JSON.stringify(isDroppingHazard)},
          ${JSON.stringify(isSettingSimGps)},
          ${JSON.stringify(gpsMode)}
        );
      }
      if (typeof window.syncShelters === 'function') {
        window.syncShelters(${JSON.stringify(shelters)}, ${JSON.stringify(gpsLabel)});
      }
      if (typeof window.syncResidents === 'function') {
        window.syncResidents(
          ${JSON.stringify(residents)},
          ${JSON.stringify(userGpsCoords)},
          ${JSON.stringify(role)},
          ${JSON.stringify(selectedResident?.id || null)}
        );
      }
      ${
        !selectedBarangay
          ? `if (typeof window.clearBarangayHighlight === 'function') { window.clearBarangayHighlight(); }`
          : ''
      }
      ${
        selectedResident
          ? `if (typeof window.focusResidentLocation === 'function') { window.focusResidentLocation(${JSON.stringify(selectedResident)}); }`
          : selectedHazardPin
          ? `if (typeof window.focusHazardLocation === 'function') { window.focusHazardLocation(${JSON.stringify(selectedHazardPin)}); }`
          : !selectedBarangay
          ? `if (typeof window.clearSelectionOverlays === 'function') { window.clearSelectionOverlays(); }`
          : ''
      }
      true;
    `);
  }, [
    cachedSectors,
    residents,
    hazards,
    shelters,
    gpsLabel,
    isDroppingHazard,
    isSettingSimGps,
    gpsMode,
    userGpsCoords,
    role,
    selectedResident,
    selectedHazardPin,
    selectedBarangay,
  ]);

  useEffect(() => {
    pushStateToWebView();
  }, [pushStateToWebView]);

  useEffect(() => {
    if (triggerGpsQuery > 0 && webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        if (typeof window.locateDeviceGps === 'function') {
          window.locateDeviceGps(${JSON.stringify(gpsMode)});
        }
        true;
      `);
    }
  }, [triggerGpsQuery, gpsMode]);

  const baseDocumentUri = (Paths.document.uri || '').replace(/\/$/, '');
  const tileSource = isOffline
    ? `${baseDocumentUri}/tiles/{z}/{x}/{y}.png`
    : `https://tile.openstreetmap.org/{z}/{x}/{y}.png`;

  const html = useMemo(() => `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          body, html, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #e2e8f0; }
          .leaflet-div-icon { background: transparent !important; border: none !important; }
          
          /* Discreet Standby Pin */
          .standby-pin {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: #94A3B8;
            border: 1.5px solid #FFFFFF;
            box-shadow: 0 1px 2px rgba(0,0,0,0.3);
          }
          .standby-pin-focused {
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background-color: #475569;
            border: 2px solid #FFFFFF;
            box-shadow: 0 0 0 3px rgba(71, 85, 105, 0.4), 0 2px 4px rgba(0,0,0,0.5);
          }

          /* Active SOS Pins */
          .micro-pin {
            width: 11px;
            height: 11px;
            border-radius: 50%;
            border: 1.5px solid #FFFFFF;
          }
          .pin-confirmed {
            box-shadow: 0 0 0 2.5px #16A34A, 0 2px 5px rgba(0,0,0,0.5) !important;
          }
          .pin-unverified {
            border: 1.5px dashed #F59E0B !important;
            box-shadow: 0 0 0 2.5px rgba(245, 158, 11, 0.45), 0 2px 4px rgba(0,0,0,0.4) !important;
          }

          .focused-pin {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            border: 2px solid #FFFFFF;
          }
          .focused-confirmed {
            box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.5), 0 2px 6px rgba(0,0,0,0.6) !important;
          }
          .focused-unverified {
            border: 2px dashed #F59E0B !important;
            box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.5), 0 2px 6px rgba(0,0,0,0.6) !important;
          }

          .home-pin {
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background-color: #FFFFFF;
            border: 2px solid #1E3A8A;
            box-shadow: 0 2px 4px rgba(0,0,0,0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
          }
          .gps-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background-color: #2563EB;
            border: 2px solid #FFFFFF;
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.35), 0 2px 4px rgba(0,0,0,0.4);
          }
          .rescuer-gps {
            width: 26px;
            height: 26px;
            border-radius: 13px;
            background-color: #0284C7;
            border: 2px solid #FFFFFF;
            box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.4), 0 2px 4px rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
          }
          .shelter-pin {
            width: 20px;
            height: 20px;
            border-radius: 4px;
            background-color: #1E3A8A;
            border: 1.5px solid white;
            box-shadow: 0 1px 4px rgba(0,0,0,0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 9.5px;
            font-weight: 800;
          }

          /* Scaled-Down Hazard Pins (Reduced from 30px to 22px) */
          .hazard-pin {
            width: 22px;
            height: 22px;
            border-radius: 11px;
            background-color: #DC2626;
            border: 1.5px solid #FFFFFF;
            box-shadow: 0 0 0 2px #16A34A, 0 2px 4px rgba(0,0,0,0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
          }
          .hazard-unverified {
            background-color: #D97706 !important;
            border: 1.5px dashed #FFFFFF !important;
            box-shadow: 0 0 0 2px rgba(217, 119, 6, 0.6), 0 2px 4px rgba(0,0,0,0.4) !important;
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map', { 
            zoomControl: false,
            minZoom: 12,
            maxZoom: 19
          }).setView([10.2550, 123.9510], 14);

          var tileLayer = L.tileLayer('${tileSource}', {
            minZoom: 12,
            maxNativeZoom: 16,
            maxZoom: 19,
            attribution: '© OpenStreetMap'
          }).addTo(map);

          tileLayer.on('tileerror', function(e) {
            if (e.tile && e.tile.src && e.tile.src.indexOf('file://') === 0) {
              var parts = e.tile.src.split('/tiles/');
              if (parts[1]) {
                e.tile.src = 'https://tile.openstreetmap.org/' + parts[1];
              }
            }
          });

          var rawData = ${JSON.stringify(rawGeoJSON)};
          var cachedSectors = {};
          var allResidents = [];
          var activeHazards = [];
          var currentRole = 'rescuer';
          var currentGpsCoords = null;
          var currentGpsMode = 'SIMULATED';
          var dropHazardActive = false;
          var dropSimGpsActive = false;
          var selectedResId = null;
          var geoWatchId = null;

          var activeLayer = null;
          var residentMarkers = [];
          var hazardMarkers = {};
          var gpsMarker = null;
          var residentSelfDisplacementLine = null;
          var selectedHomeMarker = null;
          var displacementLine = null;
          var barangayLayers = {};

          function getDistanceMeters(lat1, lon1, lat2, lon2) {
            var R = 6371e3;
            var p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
            var dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
            var a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          }

          window.clearBarangayHighlight = function() {
            if (activeLayer && geoJsonLayer) {
              geoJsonLayer.resetStyle(activeLayer);
              activeLayer = null;
            }
          };

          function renderGpsMarker(coords) {
            if (gpsMarker) { map.removeLayer(gpsMarker); gpsMarker = null; }
            if (residentSelfDisplacementLine) { map.removeLayer(residentSelfDisplacementLine); residentSelfDisplacementLine = null; }

            if (coords && coords.lat && coords.lng) {
              var isRescuer = currentRole === 'rescuer';
              var gpsIcon = L.divIcon({
                className: 'gps-dot-wrapper',
                html: isRescuer ? '<div class="rescuer-gps">🚑</div>' : '<div class="gps-dot"></div>',
                iconSize: isRescuer ? [26, 26] : [14, 14],
                iconAnchor: isRescuer ? [13, 13] : [7, 7]
              });
              gpsMarker = L.marker([coords.lat, coords.lng], { icon: gpsIcon, zIndexOffset: 1000 }).addTo(map);

              var modeLabel = currentGpsMode === 'REAL' ? '🛰️ Real-Time Hardware GPS' : '🕹️ Simulated GPS Position';
              var popupLabel = isRescuer
                ? "<b>🚑 " + escapeHtml(myUnitLabel) + "</b><br>" + modeLabel
                : "<b>🔵 My Position</b><br>" + modeLabel;

              if (!isRescuer && allResidents.length > 0) {
                var myHome = allResidents[0];
                var hLat = myHome.homeLat || myHome.lat;
                var hLng = myHome.homeLng || myHome.lng;
                var distFromHome = Math.round(getDistanceMeters(coords.lat, coords.lng, hLat, hLng));
                if (distFromHome > 35) {
                  residentSelfDisplacementLine = L.polyline([
                    [coords.lat, coords.lng],
                    [hLat, hLng]
                  ], {
                    color: '#D97706',
                    weight: 2.5,
                    dashArray: '6, 6',
                    opacity: 0.9
                  }).addTo(map);
                }
              }

              gpsMarker.bindPopup(popupLabel);
              gpsMarker.on('click', function(e) {
                if (dropHazardActive || dropSimGpsActive) return;
                L.DomEvent.stopPropagation(e);
                window.clearBarangayHighlight();
                gpsMarker.openPopup();
              });
            }
          }

          function renderResidentMarkers(list) {
            residentMarkers.forEach(function(m) { map.removeLayer(m); });
            residentMarkers = [];

            list.forEach(function(r) {
              var isSelected = r.id === selectedResId;
              var isStandby = !r.sosActive;

              if (currentRole === 'resident') {
                var homeLat = r.homeLat || r.lat;
                var homeLng = r.homeLng || r.lng;
                var homeIcon = L.divIcon({
                  className: 'home-pin-wrapper',
                  html: '<div class="home-pin" style="border-color:' + (r.color || '#1E3A8A') + ';">🏠</div>',
                  iconSize: [22, 22],
                  iconAnchor: [11, 11]
                });
                var homeMarker = L.marker([homeLat, homeLng], { icon: homeIcon }).addTo(map);
                homeMarker.on('click', function(e) {
                  if (dropHazardActive || dropSimGpsActive) return;
                  L.DomEvent.stopPropagation(e);
                  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'RESIDENT_CLICK', data: r }));
                });
                residentMarkers.push(homeMarker);
                return;
              }

              // Standby Household: Render small discreet grey/slate dot with no urgent halo
              if (isStandby) {
                var standbyClass = isSelected ? 'standby-pin-focused' : 'standby-pin';
                var standbySize = isSelected ? [14, 14] : [8, 8];
                var standbyAnchor = isSelected ? [7, 7] : [4, 4];

                var icon = L.divIcon({
                  className: 'standby-pin-wrapper',
                  html: '<div class="' + standbyClass + '"></div>',
                  iconSize: standbySize,
                  iconAnchor: standbyAnchor
                });

                var marker = L.marker([r.lat, r.lng], { icon: icon, zIndexOffset: isSelected ? 300 : 50 }).addTo(map);
                marker.on('click', function(e) {
                  if (dropHazardActive || dropSimGpsActive) return;
                  L.DomEvent.stopPropagation(e);
                  window.clearBarangayHighlight();
                  window.focusResidentLocation(r);
                  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'RESIDENT_CLICK', data: r }));
                });
                residentMarkers.push(marker);
                return;
              }

              // Active SOS Household
              var isConfirmed = r.verificationStatus === 'CONFIRMED';
              var pinClass = isSelected
                ? (isConfirmed ? 'focused-pin focused-confirmed' : 'focused-pin focused-unverified')
                : (isConfirmed ? 'micro-pin pin-confirmed' : 'micro-pin pin-unverified');
              var pinSize = isSelected ? [20, 20] : [13, 13];
              var pinAnchor = isSelected ? [10, 10] : [6.5, 6.5];
              var pinColor = r.color || '#DC2626';

              var icon = L.divIcon({
                className: 'micro-pin-wrapper',
                html: '<div class="' + pinClass + '" style="background-color:' + pinColor + ';"></div>',
                iconSize: pinSize,
                iconAnchor: pinAnchor
              });

              var marker = L.marker([r.lat, r.lng], { icon: icon, zIndexOffset: isSelected ? 900 : 150 }).addTo(map);
              marker.on('click', function(e) {
                if (dropHazardActive || dropSimGpsActive) return;
                L.DomEvent.stopPropagation(e);
                window.clearBarangayHighlight();
                window.focusResidentLocation(r);
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'RESIDENT_CLICK', data: r }));
              });
              residentMarkers.push(marker);
            });
          }

          function renderHazardMarkers(list) {
            Object.keys(hazardMarkers).forEach(function(k) { map.removeLayer(hazardMarkers[k]); });
            hazardMarkers = {};

            list.forEach(function(h) {
              var isUnverified = h.verificationStatus === 'UNVERIFIED' || h.verificationStatus === 'UNDER_REVIEW';
              var pinClass = 'hazard-pin' + (isUnverified ? ' hazard-unverified' : '');
              var icon = L.divIcon({
                className: 'hazard-pin-wrapper',
                html: '<div class="' + pinClass + '">' + (h.icon || '⚠️') + '</div>',
                iconSize: [22, 22],
                iconAnchor: [11, 11]
              });
              var marker = L.marker([h.lat, h.lng], { icon: icon, zIndexOffset: 450 }).addTo(map);
              
              marker.on('click', function(e) {
                if (dropHazardActive || dropSimGpsActive) return;
                L.DomEvent.stopPropagation(e);
                window.clearBarangayHighlight();
                window.focusHazardLocation(h);
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'HAZARD_CLICK', data: h }));
              });
              hazardMarkers[h.id] = marker;
            });
          }

          var geoJsonLayer = L.geoJSON(rawData, {
            style: function(feature) {
              var name = feature.properties.adm4_name || feature.properties.ADM4_EN || feature.properties.name;
              var isCached = Boolean(cachedSectors && cachedSectors[name]);
              return {
                stroke: isCached,
                color: isCached ? '#16A34A' : 'transparent',
                weight: 1.5,
                dashArray: '5, 5',
                opacity: 0.65,
                fill: true,
                fillColor: isCached ? '#22C55E' : '#000000',
                fillOpacity: isCached ? 0.05 : 0.001
              };
            },
            onEachFeature: function(feature, layer) {
              var name = feature.properties.adm4_name || feature.properties.ADM4_EN || feature.properties.name || "Barangay";
              barangayLayers[name] = layer;

              layer.on('click', function(e) {
                if (dropHazardActive || dropSimGpsActive || currentRole === 'resident') return;
                L.DomEvent.stopPropagation(e);
                focusBarangay(name);
                var b = layer.getBounds();
                var isCached = Boolean(cachedSectors && cachedSectors[name]);
                var cacheData = cachedSectors && cachedSectors[name];
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'BARANGAY_CLICK',
                  data: {
                    name: name,
                    isCached: isCached,
                    cachedAt: cacheData ? cacheData.cachedAt : null,
                    bounds: { minLat: b.getSouth(), maxLat: b.getNorth(), minLon: b.getWest(), maxLon: b.getEast() }
                  }
                }));
              });
            }
          }).addTo(map);

          function focusBarangay(name) {
            var layer = barangayLayers[name];
            if (!layer) return;
            window.clearBarangayHighlight();
            if (selectedHomeMarker) { map.removeLayer(selectedHomeMarker); selectedHomeMarker = null; }
            if (displacementLine) { map.removeLayer(displacementLine); displacementLine = null; }
            selectedResId = null;
            renderResidentMarkers(allResidents);

            activeLayer = layer;
            var isCached = Boolean(cachedSectors && cachedSectors[name]);
            layer.setStyle({
              stroke: true,
              color: isCached ? '#15803D' : '#DC2626',
              weight: 2.5,
              opacity: 1,
              fill: true,
              fillColor: isCached ? '#16A34A' : '#EF4444',
              fillOpacity: 0.20
            });
            map.fitBounds(layer.getBounds(), { padding: [35, 35], maxZoom: 16 });
          }

          window.syncCachedSectors = function(updatedCache) {
            cachedSectors = updatedCache || {};
            if (geoJsonLayer) {
              geoJsonLayer.eachLayer(function(layer) {
                if (layer !== activeLayer) {
                  geoJsonLayer.resetStyle(layer);
                }
              });
            }
          };

          window.syncDropModes = function(newList, hazardMode, simGpsMode, modeType) {
            activeHazards = newList || [];
            dropHazardActive = Boolean(hazardMode);
            dropSimGpsActive = Boolean(simGpsMode);
            currentGpsMode = modeType || 'SIMULATED';
            renderHazardMarkers(activeHazards);

            if (currentGpsMode === 'REAL' && navigator.geolocation && !geoWatchId) {
              geoWatchId = navigator.geolocation.watchPosition(
                function(pos) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'GPS_LOCATION_SUCCESS',
                    data: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }
                  }));
                },
                function() {},
                { enableHighAccuracy: true, maximumAge: 3000, timeout: 8000 }
              );
            } else if (currentGpsMode !== 'REAL' && geoWatchId && navigator.geolocation) {
              navigator.geolocation.clearWatch(geoWatchId);
              geoWatchId = null;
            }
          };

          window.syncResidents = function(updatedList, gpsCoords, updatedRole, activeResId) {
            allResidents = updatedList || [];
            currentGpsCoords = gpsCoords || null;
            currentRole = updatedRole || 'rescuer';
            selectedResId = activeResId || null;
            renderResidentMarkers(allResidents);
            renderGpsMarker(currentGpsCoords);
          };

          window.locateDeviceGps = function(mode) {
            window.clearBarangayHighlight();
            if (mode === 'SIMULATED' && currentGpsCoords && currentGpsCoords.lat) {
              map.flyTo([currentGpsCoords.lat, currentGpsCoords.lng], 17, { animate: true, duration: 0.6 });
              return;
            }
            map.locate({ setView: true, maxZoom: 17, enableHighAccuracy: true, timeout: 6000 });
          };

          map.on('locationfound', function(e) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'GPS_LOCATION_SUCCESS',
              data: { lat: e.latlng.lat, lng: e.latlng.lng }
            }));
          });

          map.on('locationerror', function(e) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'GPS_LOCATION_ERROR',
              message: e.message || 'Hardware GPS signal timeout'
            }));
          });

          var shelterIcon = L.divIcon({
            className: 'shelter-wrapper',
            html: '<div class="shelter-pin">H</div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
          });
          var shelterMarkers = [];
          var myUnitLabel = 'My Unit';
          function escapeHtml(t) {
            return String(t == null ? '' : t).replace(/[&<>"']/g, function(c) {
              return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
          }
          // Open evacuation centres from the database: { id, name, lat, lng, occupied, capacity }
          window.syncShelters = function(list, unitLabel) {
            myUnitLabel = unitLabel || 'My Unit';
            shelterMarkers.forEach(function(m) { map.removeLayer(m); });
            shelterMarkers = [];
            (list || []).forEach(function(c) {
              if (!c.lat || !c.lng) return;
              var pct = c.capacity ? Math.round((c.occupied / c.capacity) * 100) : 0;
              shelterMarkers.push(L.marker([c.lat, c.lng], { icon: shelterIcon })
                .addTo(map)
                .bindPopup('<b>' + escapeHtml(c.name) + '</b><br>Occupancy: <b>' + c.occupied + ' / ' + c.capacity + '</b> (' + pct + '%)'));
            });
          };

          window.focusResidentLocation = function(res) {
            window.clearBarangayHighlight();
            if (selectedHomeMarker) { map.removeLayer(selectedHomeMarker); selectedHomeMarker = null; }
            if (displacementLine) { map.removeLayer(displacementLine); displacementLine = null; }

            if (res && res.lat && res.lng) {
              selectedResId = res.id;
              renderResidentMarkers(allResidents);

              var homeLat = res.homeLat || res.lat;
              var homeLng = res.homeLng || res.lng;
              var distMeters = Math.round(getDistanceMeters(res.lat, res.lng, homeLat, homeLng));

              if (distMeters > 35) {
                var homeIcon = L.divIcon({
                  className: 'home-pin-wrapper',
                  html: '<div class="home-pin">🏠</div>',
                  iconSize: [22, 22],
                  iconAnchor: [11, 11]
                });

                selectedHomeMarker = L.marker([homeLat, homeLng], { icon: homeIcon, zIndexOffset: 850 })
                  .addTo(map);

                displacementLine = L.polyline([
                  [res.lat, res.lng],
                  [homeLat, homeLng]
                ], {
                  color: '#D97706',
                  weight: 2.5,
                  dashArray: '5, 5',
                  opacity: 0.9
                }).addTo(map);

                map.fitBounds([
                  [res.lat, res.lng],
                  [homeLat, homeLng]
                ], { padding: [60, 60], maxZoom: 17, animate: true });
              } else {
                map.flyTo([res.lat, res.lng], 17, { animate: true, duration: 0.5 });
              }
            }
          };

          window.focusHazardLocation = function(haz) {
            window.clearBarangayHighlight();
            if (!haz || !haz.lat || !haz.lng) return;
            map.flyTo([haz.lat, haz.lng], 17, { animate: true, duration: 0.5 });
          };

          window.clearSelectionOverlays = function() {
            window.clearBarangayHighlight();
            if (selectedHomeMarker) { map.removeLayer(selectedHomeMarker); selectedHomeMarker = null; }
            if (displacementLine) { map.removeLayer(displacementLine); displacementLine = null; }
            selectedResId = null;
            renderResidentMarkers(allResidents);
          };

          map.on('click', function(e) {
            if (dropSimGpsActive) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'SIM_GPS_PIN_DROP',
                data: { lat: e.latlng.lat, lng: e.latlng.lng }
              }));
              return;
            }
            if (dropHazardActive) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'HAZARD_PIN_DROP',
                data: { lat: e.latlng.lat, lng: e.latlng.lng }
              }));
              return;
            }
            window.clearSelectionOverlays();
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_BLANK_CLICK' }));
          });
        </script>
      </body>
    </html>
  `, [tileSource]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html }}
        style={styles.map}
        geolocationEnabled={true}
        onLoadEnd={pushStateToWebView}
        onMessage={(event) => {
          try {
            const message = JSON.parse(event.nativeEvent.data);
            if (message.type === 'BARANGAY_CLICK' && onBarangaySelect) {
              onBarangaySelect(message.data);
            } else if (message.type === 'RESIDENT_CLICK' && onPinSelect) {
              onPinSelect(message.data);
            } else if (message.type === 'HAZARD_CLICK' && onHazardPinSelect) {
              onHazardPinSelect(message.data);
            } else if (message.type === 'HAZARD_PIN_DROP' && onHazardCoordinateDrop) {
              onHazardCoordinateDrop(message.data);
            } else if (message.type === 'SIM_GPS_PIN_DROP' && onSimGpsCoordinateDrop) {
              onSimGpsCoordinateDrop(message.data);
            } else if (message.type === 'GPS_LOCATION_SUCCESS' && onGpsLocationFound) {
              onGpsLocationFound(message.data);
            } else if (message.type === 'GPS_LOCATION_ERROR' && onGpsLocationError) {
              onGpsLocationError(message.message);
            } else if (message.type === 'MAP_BLANK_CLICK' && onMapClick) {
              onMapClick();
            }
          } catch (e) {
            console.warn('Map message parse error:', e);
          }
        }}
        allowFileAccess={true}
        allowUniversalAccessFromFileURLs={true}
        javaScriptEnabled={true}
        domStorageEnabled={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
});