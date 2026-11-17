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
  focusPoint = null, // { key, lat, lng, label, note, icon, barangay }: flies to a disaster and marks it
  selectedResident = null,
  selectedHazardPin = null,
  // Live position of the rescue unit coming to this resident:
  // { lat, lng, accuracy, label, stale } (null hides it). Animated as it moves.
  rescuerPoint = null,
  // Evacuation center reserved for the mission: { key, lat, lng, name } (null clears).
  // Drawn as a destination pin with the route from this phone to it.
  missionTarget = null,
  pinLabel = null, // popup text for this phone's dot (e.g. "Your home pin") instead of the GPS mode
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
  const focusedKey = useRef(null);
  const focusedSelKey = useRef(null);

  const pushStateToWebView = useCallback(() => {
    if (!webViewRef.current) return;
    const doFocus = Boolean(focusPoint && focusedKey.current !== focusPoint.key);
    // Fly to a selected pin only when the selection changes, not on every GPS update,
    // so the map does not jump back while the phone is moving or the user is panning.
    const selKey = selectedResident
      ? `r:${selectedResident.id}:${selectedResident.lat},${selectedResident.lng}`
      : selectedHazardPin
      ? `h:${selectedHazardPin.id}`
      : null;
    const doSelFocus = Boolean(selKey && focusedSelKey.current !== selKey);

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
      window.__pinLabel = ${JSON.stringify(pinLabel)};
      if (typeof window.syncResidents === 'function') {
        window.syncResidents(
          ${JSON.stringify(residents)},
          ${JSON.stringify(userGpsCoords)},
          ${JSON.stringify(role)},
          ${JSON.stringify(selectedResident?.id || null)}
        );
      }
      if (typeof window.syncRescuer === 'function') {
        window.syncRescuer(${JSON.stringify(rescuerPoint)});
      }
      ${
        !selectedBarangay
          ? `if (typeof window.clearBarangayHighlight === 'function') { window.clearBarangayHighlight(); }`
          : ''
      }
      ${
        doFocus
          ? `if (typeof window.focusDisasterPoint === 'function') { window.focusDisasterPoint(${JSON.stringify(focusPoint)}); }`
          : ''
      }
      ${
        doFocus
          ? ''
          : selectedResident
          ? doSelFocus ? `if (typeof window.focusResidentLocation === 'function') { window.focusResidentLocation(${JSON.stringify(selectedResident)}); }` : ''
          : selectedHazardPin
          ? doSelFocus ? `if (typeof window.focusHazardLocation === 'function') { window.focusHazardLocation(${JSON.stringify(selectedHazardPin)}); }` : ''
          : !selectedBarangay
          ? `if (typeof window.clearSelectionOverlays === 'function') { window.clearSelectionOverlays(); }`
          : ''
      }
      if (typeof window.syncMission === 'function') {
        window.syncMission(${JSON.stringify(missionTarget)});
      }
      true;
    `);
    if (doFocus) focusedKey.current = focusPoint.key;
    else focusedSelKey.current = selKey;
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
    focusPoint,
    rescuerPoint,
    missionTarget,
    pinLabel,
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

          .disaster-pin {
            width: 40px; height: 40px; border-radius: 20px; background: #DC2626; border: 3px solid #FFF;
            display: flex; align-items: center; justify-content: center; font-size: 20px;
            box-shadow: 0 0 0 6px rgba(220, 38, 38, 0.35); animation: disasterPulse 1.4s infinite;
          }
          @keyframes disasterPulse {
            0% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.6); }
            100% { box-shadow: 0 0 0 22px rgba(220, 38, 38, 0); }
          }
          .route-info {
            display: flex; align-items: flex-start; gap: 10px; max-width: 260px;
            padding: 10px 12px; border-radius: 12px; background: #FFFFFF; color: #0F172A;
            font: 13px/1.4 -apple-system, Roboto, sans-serif; box-shadow: 0 2px 10px rgba(0,0,0,0.25);
          }
          .route-info small { color: #475569; }
          .route-close {
            border: 0; background: #E2E8F0; color: #0F172A; border-radius: 12px;
            width: 24px; height: 24px; font-size: 13px; line-height: 24px; padding: 0; flex: none;
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
          .unit-live {
            width: 30px; height: 30px; border-radius: 15px;
            background-color: #DC2626; border: 2px solid #FFFFFF;
            box-shadow: 0 0 0 4px rgba(220, 38, 38, 0.30), 0 2px 5px rgba(0,0,0,0.5);
            display: flex; align-items: center; justify-content: center; font-size: 15px;
          }
          .unit-live.stale { background-color: #94A3B8; box-shadow: 0 0 0 4px rgba(100, 116, 139, 0.25), 0 2px 5px rgba(0,0,0,0.4); }
          .mission-pin {
            width: 30px; height: 30px; border-radius: 15px 15px 15px 2px;
            background-color: #16A34A; border: 2px solid #FFFFFF; color: #FFFFFF;
            box-shadow: 0 2px 5px rgba(0,0,0,0.5); transform: rotate(-45deg);
            display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 13px;
          }
          .mission-pin span { transform: rotate(45deg); }
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

          // ---------- Route from this phone to a target (disaster or SOS) ----------
          // Road route from the free OpenStreetMap router when online; a straight dashed
          // line with distance and direction when it cannot be reached.
          var myCoords = null;
          var route = null; // { slot, key, name, from, to, layers, token }
          var routeInfo = L.control({ position: 'topleft' });
          routeInfo.onAdd = function() {
            var d = L.DomUtil.create('div', 'route-info');
            d.style.display = 'none';
            L.DomEvent.disableClickPropagation(d);
            this._div = d;
            return d;
          };
          routeInfo.addTo(map);
          function fmtDist(m) {
            return m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km' : Math.max(10, Math.round(m / 10) * 10) + ' m';
          }
          function fmtTime(sec) {
            var m = Math.max(1, Math.round(sec / 60));
            return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min';
          }
          function directionName(lat1, lng1, lat2, lng2) {
            var r = Math.PI / 180;
            var y = Math.sin((lng2 - lng1) * r) * Math.cos(lat2 * r);
            var x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
            var b = (Math.atan2(y, x) / r + 360) % 360;
            return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(b / 45) % 8];
          }
          function clearRoute() {
            if (!route) return;
            route.layers.forEach(function(l) { map.removeLayer(l); });
            route = null;
            if (routeInfo._div) routeInfo._div.style.display = 'none';
          }
          function showRouteInfo(html) {
            var d = routeInfo._div;
            if (!d) return;
            d.innerHTML = '<div>' + html + '</div><button class="route-close" aria-label="Hide route">✕</button>';
            d.style.display = 'flex';
            // Sit below the app's own top bar and search box, clear of the bottom sheets.
            d.style.marginTop = currentRole === 'rescuer' ? '175px' : '12px';
            d.querySelector('.route-close').onclick = function(e) { e.stopPropagation(); clearRoute(); };
          }
          window.clearRouteSlot = function(slot) { if (route && route.slot === slot) clearRoute(); };
          // Turn-by-turn text from an OSRM step.
          function stepText(st) {
            var m = st.maneuver || {}, mod = m.modifier ? m.modifier.replace('uturn', 'U-turn') : '';
            var road = st.name ? ' onto <b>' + escapeHtml(st.name) + '</b>' : '';
            switch (m.type) {
              case 'depart': return 'Head ' + (mod || 'out') + road;
              case 'arrive': return 'Arrive at <b>' + escapeHtml(route ? route.name : 'the destination') + '</b>';
              case 'roundabout': case 'rotary': return 'At the roundabout take exit ' + (m.exit || '') + road;
              case 'merge': return 'Merge ' + mod + road;
              case 'fork': return 'Keep ' + mod + ' at the fork' + road;
              case 'end of road': return 'At the end of the road turn ' + mod + road;
              case 'continue': case 'new name': return (mod && mod !== 'straight' ? 'Bear ' + mod : 'Continue straight') + road;
              default: return (mod ? 'Turn ' + mod : 'Continue') + road;
            }
          }
          function distToRouteM(p, pts) {
            // Shortest distance from p to the polyline (flat-earth, fine at city scale).
            var best = Infinity, k = Math.cos(p.lat * Math.PI / 180) * 111320, ky = 110540;
            for (var i = 0; i < pts.length - 1; i++) {
              var ax = (pts[i][1] - p.lng) * k, ay = (pts[i][0] - p.lat) * ky;
              var bx = (pts[i + 1][1] - p.lng) * k, by = (pts[i + 1][0] - p.lat) * ky;
              var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
              var t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
              var x = ax + t * dx, y = ay + t * dy, d = Math.sqrt(x * x + y * y);
              if (d < best) best = d;
            }
            return best;
          }
          var OFF_ROUTE_M = 40;
          // Called on every GPS fix: keeps a drawn road route, reroutes only when the phone
          // leaves it, and during navigation shows the next instruction and follows the phone.
          function updateRouteProgress() {
            if (!route || !myCoords) return;
            if (!route.pts) { // no road route yet (or offline): retry as the phone moves
              window.routeTo(route.slot, route.key, route.to.lat, route.to.lng, route.name, false, route.navigate);
              return;
            }
            // Off the road route: ask for a new one, at most every 10 s.
            if (distToRouteM(myCoords, route.pts) > OFF_ROUTE_M && Date.now() - (route.fetchedAt || 0) > 10000) {
              window.routeTo(route.slot, route.key, route.to.lat, route.to.lng, route.name, false, route.navigate, true);
              return;
            }
            showNavStep();
          }
          function showNavStep() {
            if (!route || !myCoords || !route.navigate || !route.steps) return;
            // Steps already reached (within 20 m of their turn point) are passed.
            while (route.stepIdx < route.steps.length - 1) {
              var loc = route.steps[route.stepIdx].maneuver.location;
              if (getDistanceMeters(myCoords.lat, myCoords.lng, loc[1], loc[0]) > 20) break;
              route.stepIdx++;
            }
            var st = route.steps[route.stepIdx], l2 = st.maneuver.location;
            var dNext = getDistanceMeters(myCoords.lat, myCoords.lng, l2[1], l2[0]);
            var left = getDistanceMeters(myCoords.lat, myCoords.lng, route.to.lat, route.to.lng);
            showRouteInfo('➡️ In <b>' + fmtDist(dNext) + '</b>: ' + stepText(st) +
              '<br><small>' + escapeHtml(route.name) + ': ' + fmtDist(left) + ' away</small>');
            map.panTo([myCoords.lat, myCoords.lng], { animate: true });
          }

          window.routeTo = function(slot, key, lat, lng, name, fit, navigate, force) {
            if (!lat || !lng) return;
            name = name || 'the location';
            if (!myCoords) {
              clearRoute();
              showRouteInfo('📍 Turn on location to see the way to <b>' + escapeHtml(name) + '</b>.');
              return;
            }
            // Same target, same mode and still on (or near) it: keep the route already drawn.
            if (!force && route && route.key === key && Boolean(route.navigate) === Boolean(navigate) &&
                (route.pts ? distToRouteM(myCoords, route.pts) <= OFF_ROUTE_M
                           : getDistanceMeters(route.from.lat, route.from.lng, myCoords.lat, myCoords.lng) < 30)) return;
            var isNew = !route || route.key !== key;
            clearRoute();
            var from = { lat: myCoords.lat, lng: myCoords.lng };
            var token = {};
            route = { slot: slot, key: key, name: name, from: from, to: { lat: lat, lng: lng }, layers: [], token: token,
                      navigate: Boolean(navigate), pts: null, steps: null, stepIdx: 0 };

            var straight = L.polyline([[from.lat, from.lng], [lat, lng]], {
              color: '#2563EB', weight: 3, dashArray: '6, 8', opacity: 0.85
            }).addTo(map);
            route.layers.push(straight);
            var straightText = '📏 <b>' + fmtDist(getDistanceMeters(from.lat, from.lng, lat, lng)) + '</b> ' +
              directionName(from.lat, from.lng, lat, lng) + ' of you, in a straight line';
            showRouteInfo('🧭 Finding the road route to <b>' + escapeHtml(name) + '</b>…');
            if (fit && isNew) map.fitBounds([[from.lat, from.lng], [lat, lng]], { padding: [70, 70], maxZoom: 17 });

            var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            var timer = setTimeout(function() { if (ctrl) ctrl.abort(); }, 8000);
            var url = 'https://router.project-osrm.org/route/v1/driving/' +
              from.lng + ',' + from.lat + ';' + lng + ',' + lat + '?overview=full&geometries=geojson' + (navigate ? '&steps=true' : '');
            fetch(url, ctrl ? { signal: ctrl.signal } : {})
              .then(function(r) { if (!r.ok) throw new Error('route ' + r.status); return r.json(); })
              .then(function(j) {
                clearTimeout(timer);
                if (!route || route.token !== token) return;
                var rt = j && j.routes && j.routes[0];
                if (!rt || !rt.geometry || !rt.geometry.coordinates.length) throw new Error('no route');
                map.removeLayer(straight);
                var pts = rt.geometry.coordinates.map(function(c) { return [c[1], c[0]]; });
                var casing = L.polyline(pts, { color: '#FFFFFF', weight: 8, opacity: 0.9 }).addTo(map);
                var line = L.polyline(pts, { color: '#2563EB', weight: 5, opacity: 0.95 }).addTo(map);
                // Short dotted links where the road ends short of the exact points.
                var ends = L.polyline([[from.lat, from.lng], pts[0]], { color: '#2563EB', weight: 2, dashArray: '2, 6' }).addTo(map);
                var ends2 = L.polyline([pts[pts.length - 1], [lat, lng]], { color: '#2563EB', weight: 2, dashArray: '2, 6' }).addTo(map);
                route.layers = [casing, line, ends, ends2];
                route.pts = pts;
                route.fetchedAt = Date.now();
                var legSteps = rt.legs && rt.legs[0] && rt.legs[0].steps;
                if (navigate && legSteps && legSteps.length) {
                  route.steps = legSteps;
                  route.stepIdx = legSteps.length > 1 ? 1 : 0; // step 0 is "depart" from here
                  showNavStep();
                  return;
                }
                showRouteInfo('🧭 <b>' + fmtDist(rt.distance) + '</b> by road, about <b>' + fmtTime(rt.duration) +
                  '</b> by car<br><small>to ' + escapeHtml(name) + '</small>');
                if (fit && isNew) map.fitBounds(line.getBounds(), { padding: [70, 70], maxZoom: 17 });
              })
              .catch(function() {
                clearTimeout(timer);
                if (!route || route.token !== token) return;
                showRouteInfo(straightText + '<br><small>No connection for a road route. Head toward ' + escapeHtml(name) + ' using the roads you know.</small>');
              });
          };

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
            myCoords = coords && coords.lat && coords.lng ? { lat: coords.lat, lng: coords.lng } : null;
            updateRouteProgress();
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
              var popupLabel = window.__pinLabel ? '<b>' + escapeHtml(window.__pinLabel) + '</b>' : isRescuer
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
            window.clearRouteSlot('selection');
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
              if (currentRole === 'rescuer') window.routeTo('selection', 'r:' + res.id, res.lat, res.lng, res.name || 'the resident', true);

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

          // Flies to a declared disaster and drops a pulsing red pin on it. Without exact
          // coordinates it zooms to the disaster's barangay instead.
          var disasterMarker = null;
          window.focusDisasterPoint = function(p) {
            if (!p) return;
            if (disasterMarker) { map.removeLayer(disasterMarker); disasterMarker = null; }
            if (p.lat && p.lng) {
              var icon = L.divIcon({
                className: 'disaster-pin-wrapper',
                html: '<div class="disaster-pin">' + escapeHtml(p.icon || '⚠️') + '</div>',
                iconSize: [40, 40],
                iconAnchor: [20, 20]
              });
              disasterMarker = L.marker([p.lat, p.lng], { icon: icon, zIndexOffset: 1000 })
                .addTo(map)
                .bindPopup('<b>' + escapeHtml(p.label || 'Disaster') + '</b>' + (p.note ? '<br>' + escapeHtml(p.note) : ''));
              if (myCoords) window.routeTo('disaster', 'd:' + (p.key || p.lat + ',' + p.lng), p.lat, p.lng, p.label || 'the disaster', true);
              else map.flyTo([p.lat, p.lng], 16, { animate: true, duration: 0.8 });
              setTimeout(function() { if (disasterMarker) disasterMarker.openPopup(); }, 900);
            } else if (p.barangay) {
              var want = String(p.barangay).toLowerCase().replace(/[^a-z]/g, '');
              var name = Object.keys(barangayLayers).filter(function(k) {
                return k.toLowerCase().replace(/[^a-z]/g, '') === want;
              })[0];
              if (name) map.fitBounds(barangayLayers[name].getBounds(), { padding: [35, 35], maxZoom: 16 });
            }
          };

          // ---------- Rescue unit coming to this resident (live, animated) ----------
          var rescuerMarker = null, rescuerCircle = null, rescuerAnim = null, rescuerFitted = false;
          function rescuerIcon(stale) {
            return L.divIcon({
              className: 'gps-dot-wrapper',
              html: '<div class="unit-live' + (stale ? ' stale' : '') + '">🚑</div>',
              iconSize: [30, 30], iconAnchor: [15, 15]
            });
          }
          window.syncRescuer = function(p) {
            if (!p || !p.lat || !p.lng) {
              if (rescuerAnim) cancelAnimationFrame(rescuerAnim);
              if (rescuerMarker) { map.removeLayer(rescuerMarker); rescuerMarker = null; }
              if (rescuerCircle) { map.removeLayer(rescuerCircle); rescuerCircle = null; }
              rescuerFitted = false;
              return;
            }
            var label = '<b>🚑 ' + escapeHtml(p.label || 'Rescue unit') + '</b>' +
              (p.accuracy ? '<br>GPS accuracy ±' + Math.round(p.accuracy) + ' m' : '') +
              (p.stale ? '<br><i>Last known position</i>' : '');
            if (!rescuerMarker) {
              rescuerMarker = L.marker([p.lat, p.lng], { icon: rescuerIcon(p.stale), zIndexOffset: 1200 }).addTo(map).bindPopup(label);
              rescuerCircle = L.circle([p.lat, p.lng], {
                radius: p.accuracy || 0, color: '#DC2626', weight: 1, opacity: 0.4, fillOpacity: 0.08
              }).addTo(map);
              rescuerMarker._stale = Boolean(p.stale);
            } else {
              if (rescuerMarker._stale !== Boolean(p.stale)) {
                rescuerMarker.setIcon(rescuerIcon(p.stale));
                rescuerMarker._stale = Boolean(p.stale);
              }
              rescuerMarker.setPopupContent(label);
              rescuerCircle.setRadius(p.accuracy || 0);
              // Glide to the new fix instead of jumping.
              var from = rescuerMarker.getLatLng(), to = L.latLng(p.lat, p.lng);
              if (from.lat !== to.lat || from.lng !== to.lng) {
                if (rescuerAnim) cancelAnimationFrame(rescuerAnim);
                var t0 = null, dur = 1200;
                var step = function(ts) {
                  if (t0 === null) t0 = ts;
                  var k = Math.min(1, (ts - t0) / dur);
                  var e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
                  var ll = L.latLng(from.lat + (to.lat - from.lat) * e, from.lng + (to.lng - from.lng) * e);
                  rescuerMarker.setLatLng(ll);
                  rescuerCircle.setLatLng(ll);
                  if (k < 1) rescuerAnim = requestAnimationFrame(step);
                };
                rescuerAnim = requestAnimationFrame(step);
              }
            }
            // First time: show both the unit and this phone (or the resident's pin).
            if (!rescuerFitted) {
              rescuerFitted = true;
              var other = myCoords || currentGpsCoords;
              if (other && other.lat) map.fitBounds([[p.lat, p.lng], [other.lat, other.lng]], { padding: [80, 80], maxZoom: 17 });
              else map.flyTo([p.lat, p.lng], 16, { animate: true, duration: 0.8 });
            }
          };

          // ---------- Evacuation center reserved for this mission ----------
          // Its route takes priority over the route to a selected pin.
          var missionMarker = null, missionKey = null;
          window.syncMission = function(t) {
            if (!t || !t.lat || !t.lng) {
              if (missionMarker) { map.removeLayer(missionMarker); missionMarker = null; }
              if (missionKey) window.clearRouteSlot('mission');
              missionKey = null;
              return;
            }
            var isNew = missionKey !== t.key;
            if (isNew) {
              if (missionMarker) map.removeLayer(missionMarker);
              missionMarker = L.marker([t.lat, t.lng], {
                icon: L.divIcon({ className: 'gps-dot-wrapper', html: '<div class="mission-pin"><span>H</span></div>', iconSize: [30, 30], iconAnchor: [15, 30] }),
                zIndexOffset: 1100
              }).addTo(map).bindPopup('<b>🏫 ' + escapeHtml(t.name) + '</b><br>Reserved for this rescue');
              missionKey = t.key;
            }
            // t.navigate: turn-by-turn and follow the phone; otherwise a route preview.
            if (isNew || !route || route.slot !== 'mission' || Boolean(route.navigate) !== Boolean(t.navigate)) {
              window.routeTo('mission', 'm:' + t.key, t.lat, t.lng, t.name || 'the evacuation center', isNew || !t.navigate, t.navigate);
            }
          };

          window.clearSelectionOverlays = function() {
            window.clearBarangayHighlight();
            if (selectedHomeMarker) { map.removeLayer(selectedHomeMarker); selectedHomeMarker = null; }
            if (displacementLine) { map.removeLayer(displacementLine); displacementLine = null; }
            window.clearRouteSlot('selection');
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
        onLoadEnd={() => { focusedKey.current = null; focusedSelKey.current = null; pushStateToWebView(); }}
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