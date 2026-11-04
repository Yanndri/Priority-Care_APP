import { Stack } from 'expo-router';
import { DisasterWatcher } from '../../components/DisasterBanner';

export default function RescuerLayout() {
  return (
    <>
    {/* Pops up any disaster declared in Cordova, on any screen. */}
    <DisasterWatcher />
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