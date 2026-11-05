import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

// Cordova, Cebu: where the map starts when nothing is pinned yet.
export const CORDOVA_CENTER = { lat: 10.2526, lng: 123.9496 };

// A small map with a pin in the middle.
// - interactive=false: a preview that just shows where the pin is.
// - interactive=true: the person drags the map under the pin (like Shopee);
//   onMove({lat, lng}) gets the spot under the pin each time the map stops.
// Change `center` (a new object) to move the map, e.g. after reading GPS.
export default function HomePinMap({ center, interactive = false, onMove, style }) {
  const ref = useRef(null);
  const start = center || CORDOVA_CENTER;

  // Built once; later moves are sent in with injectJavaScript.
  const html = useMemo(() => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { margin: 0; height: 100%; }
  #pin { position: absolute; left: 50%; top: 50%; z-index: 999; font-size: 34px; line-height: 34px;
         transform: translate(-50%, -100%); pointer-events: none; }
</style></head><body>
<div id="map"></div><div id="pin">📍</div>
<script>
  var interactive = ${interactive ? 'true' : 'false'};
  var map = L.map('map', { zoomControl: interactive, dragging: interactive, touchZoom: interactive,
    scrollWheelZoom: false, doubleClickZoom: interactive, attributionControl: false })
    .setView([${start.lat}, ${start.lng}], 17);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  window.moveTo = function (lat, lng) { map.setView([lat, lng], Math.max(map.getZoom(), 17)); };
  map.on('moveend', function () {
    var c = map.getCenter();
    window.ReactNativeWebView.postMessage(JSON.stringify({ lat: c.lat, lng: c.lng }));
  });
</script></body></html>`, [interactive]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (center && ref.current) ref.current.injectJavaScript(`window.moveTo && window.moveTo(${center.lat}, ${center.lng}); true;`);
  }, [center]);

  return (
    <View style={[styles.wrap, style]} pointerEvents={interactive ? 'auto' : 'none'}>
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={{ html }}
        javaScriptEnabled
        nestedScrollEnabled
        onMessage={(e) => {
          if (!interactive || !onMove) return;
          try { onMove(JSON.parse(e.nativeEvent.data)); } catch { /* ignore */ }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 180, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#E2E8F0' },
});
