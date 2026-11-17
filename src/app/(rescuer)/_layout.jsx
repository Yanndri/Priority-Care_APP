import { Stack } from 'expo-router';
import { DisasterWatcher } from '../../components/DisasterBanner';
import { SosWatcher } from '../../components/SosAlarm';
import { MissionTracker } from '../../components/MissionTracker';

export default function RescuerLayout() {
  return (
    <>
    {/* Pops up any disaster declared in Cordova, on any screen. */}
    <DisasterWatcher />
    {/* Siren, vibration and a phone notification when a new SOS comes in. */}
    <SosWatcher />
    {/* Shares the unit's live GPS during a mission and alerts at 100 m / 10 m / 5 m. */}
    <MissionTracker />
    <Stack
      screenOptions={{
        headerShown: false, // Screens manage their own headers
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="map" />
      <Stack.Screen name="alerts" />
      <Stack.Screen name="profile" />
    </Stack>
    </>
  );
}