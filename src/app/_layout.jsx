// src/app/_layout.jsx
import { Stack } from 'expo-router';
import { SessionProvider } from '../components/SessionProvider';

export default function RootLayout() {
  return (
    <SessionProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </SessionProvider>
  );
}
