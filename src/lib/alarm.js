// Shared emergency alarm: a looping siren, vibration and a phone notification.
// Used for new SOS calls (rescuers) and new disaster declarations (residents and rescuers).
import { Vibration, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

// Android keeps a channel's sound once it is made, so change the id if the sound changes.
export const CHANNEL_ID = 'sos-alerts-v1';
const SOUND_FILE = 'sos_siren.wav';
const SIREN = require('../../assets/sounds/sos_siren.wav');
const RING_LIMIT_MS = 60000; // stops by itself after a minute if nobody presses anything
const VIBRATE = [0, 800, 300, 800, 300, 800, 1000];

// While the app is open the siren plays from the app itself, so the notification stays quiet.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let ready = null;
let player = null;
let stopTimer = null;

// Sets up the notification channel, asks for permission and loads the siren (once).
export function prepareAlarm() {
  if (!ready) {
    ready = (async () => {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
          name: 'Emergency alerts',
          description: 'Rings for new SOS calls and disaster declarations',
          importance: Notifications.AndroidImportance.MAX,
          sound: SOUND_FILE,
          vibrationPattern: VIBRATE,
          lightColor: '#DC2626',
          bypassDnd: true,
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
          audioAttributes: {
            usage: Notifications.AndroidAudioUsage.ALARM,
            contentType: Notifications.AndroidAudioContentType.SONIFICATION,
          },
        });
      }
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') await Notifications.requestPermissionsAsync();
      // Rings even when the phone is on silent (iOS) and pauses music from other apps.
      await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix' });
    })().catch(() => {});
  }
  if (!player) {
    try {
      player = createAudioPlayer(SIREN);
      player.loop = true;
      player.volume = 1;
    } catch { player = null; }
  }
  return ready;
}

export function stopAlarm() {
  clearTimeout(stopTimer);
  try { player?.pause(); } catch { /* ignore */ }
  Vibration.cancel();
}

// Rings the siren and vibrates, and puts a notification on the phone.
export async function soundAlarm({ title, body, data = {} }) {
  prepareAlarm();
  try {
    await player?.seekTo(0);
    player?.play();
  } catch { /* no sound: the notification and vibration still go off */ }
  Vibration.vibrate(VIBRATE, true);
  clearTimeout(stopTimer);
  stopTimer = setTimeout(stopAlarm, RING_LIMIT_MS);
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: SOUND_FILE,
        priority: Notifications.AndroidNotificationPriority.MAX,
        data,
      },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
    });
  } catch { /* notifications turned off: the in-app alert still shows */ }
}

// Calls onTap when someone taps one of our notifications of this kind. Returns an unsubscribe.
export function onAlarmTap(kind, onTap) {
  const sub = Notifications.addNotificationResponseReceivedListener((res) => {
    if (res.notification.request.content.data?.kind !== kind) return;
    stopAlarm();
    onTap(res);
  });
  return () => sub.remove();
}
