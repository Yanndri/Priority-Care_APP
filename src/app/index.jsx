// src/app/index.jsx: send a signed-in user straight to their portal.
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSession } from '../components/SessionProvider';

export default function Index() {
  const { profile, loading } = useSession();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC' }}>
        <ActivityIndicator color="#1E3A8A" />
      </View>
    );
  }
  if (profile?.role === 'resident') return <Redirect href="/(resident)" />;
  if (profile?.role === 'rescuer') return <Redirect href="/(rescuer)/map" />;
  return <Redirect href="/(auth)/login" />;
}
