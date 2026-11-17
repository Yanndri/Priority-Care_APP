import { Stack } from 'expo-router';
import { useSession } from '../../components/SessionProvider';
import { DisasterWatcher } from '../../components/DisasterBanner';
import { RescueWatcher } from '../../components/RescueWatcher';

export default function ResidentLayout() {
  const { profile } = useSession();
  const barangayId = profile?.resident?.barangay_id ?? null;
  return (
    <>
      {/* Pops up a disaster declared for the resident's barangay, on any screen. */}
      <DisasterWatcher barangayId={barangayId} enabled={barangayId != null} />
      {/* Live rescue unit, proximity alerts and the assigned evacuation center. */}
      <RescueWatcher enabled={Boolean(profile)} />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
