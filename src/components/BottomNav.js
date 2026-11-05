import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/colors';

const RESCUER_ITEMS = [
  { label: 'Dispatch', icon: '📋', path: '/(rescuer)' },
  { label: 'Map', icon: '🗺️', path: '/(rescuer)/map' },
  { label: 'Hazards', icon: '🚨', path: '/(rescuer)/alerts' },
  { label: 'Shelters', icon: '🏥', path: '/(rescuer)/shelters' },
  { label: 'Terminal', icon: '📡', path: '/(rescuer)/profile' },
];

const RESIDENT_ITEMS = [
  { label: 'Emergency SOS', icon: '🚨', path: '/(resident)', tab: 'SOS' },
  { label: 'Live Map', icon: '🗺️', path: '/(resident)/evac-map' },
  { label: 'Shelters', icon: '🏥', path: '/(resident)', tab: 'SHELTERS' },
  { label: 'Profile', icon: '👤', path: '/(resident)/profile' },
];

export default function BottomNav({ role = null, activeTab = null, onTabChange = null }) {
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();

  const isResident = role ? role === 'resident' : segments.includes('(resident)');
  const navItems = isResident ? RESIDENT_ITEMS : RESCUER_ITEMS;
  const currentScreen = segments[segments.length - 1] || 'index';

  const handlePress = (item) => {
    if (isResident) {
      const isHome = currentScreen === 'index' || currentScreen === '(resident)';
      if (item.tab) {
        if (isHome && onTabChange) {
          onTabChange(item.tab);
        } else {
          router.replace({ pathname: '/(resident)', params: { tab: item.tab } });
        }
        return;
      }
      router.replace(item.path);
      return;
    }

    router.replace(item.path);
  };

  return (
    <View style={[styles.navBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {navItems.map((item) => {
        let isActive = false;

        if (isResident) {
          const isHome = currentScreen === 'index' || currentScreen === '(resident)';
          if (isHome && item.tab) {
            isActive = activeTab === item.tab;
          } else if (item.path.includes('/evac-map')) {
            isActive = segments.includes('evac-map');
          } else if (item.path.includes('/profile')) {
            isActive = segments.includes('profile');
          }
        } else {
          if (item.path === '/(rescuer)') {
            isActive = currentScreen === '(rescuer)' || currentScreen === 'index';
          } else if (item.path.includes('/map')) {
            isActive = segments.includes('map');
          } else if (item.path.includes('/alerts')) {
            isActive = segments.includes('alerts');
          } else if (item.path.includes('/shelters')) {
            isActive = segments.includes('shelters');
          } else if (item.path.includes('/profile')) {
            isActive = segments.includes('profile');
          }
        }

        return (
          <TouchableOpacity
            key={item.label}
            style={styles.navButton}
            activeOpacity={0.65}
            onPress={() => handlePress(item)}
          >
            <Text style={[styles.navIcon, isActive && styles.navIconActive]}>
              {item.icon}
            </Text>
            <Text style={[styles.navLabel, isActive && styles.navLabelActive]} numberOfLines={1}>
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  navBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 8,
    elevation: 8,
  },
  navButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIcon: {
    fontSize: 20,
    opacity: 0.45,
  },
  navIconActive: {
    opacity: 1,
    transform: [{ scale: 1.15 }],
  },
  navLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
  },
  navLabelActive: {
    color: COLORS.primary || '#1E3A8A',
    fontWeight: '900',
  },
});