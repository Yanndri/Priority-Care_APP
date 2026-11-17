import { Stack } from 'expo-router';
import { useSession } from '../../components/SessionProvider';
import { DisasterWatcher } from '../../components/DisasterBanner';
import { RescueWatcher } from '../../components/RescueWatcher';
import NearbyHazardWatcher from '../../components/NearbyHazardWatcher';

export default function ResidentLayout() {
  const { profile } = useSession();
  const barangayId = profile?.resident?.barangay_id ?? null;
  return (
    <>
      {/* Pops up a disaster declared for the resident's barangay, on any screen. */}
      <DisasterWatcher barangayId={barangayId} enabled={barangayId != null} />
      {/* Tells the resident each rescue step: assigned, on the way, arrived, evacuated. */}
      <RescueWatcher enabled={Boolean(profile)} />
      {/* Asks "Do you see it too?" when someone pins a hazard near you. */}
      <NearbyHazardWatcher />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
