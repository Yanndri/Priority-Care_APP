# PriorityCare (mobile app)

The resident and rescuer app for PriorityCare, built with **Expo SDK 58** (React Native 0.88, React 19.3) and **Expo Router**. It talks directly to the shared Supabase project **priority-care-prototype** (`urioaayowijvhwbuxxaj`), the same database the PriorityCare web dashboard uses.

We run the app in **Expo Go** on a phone. You do not need Android Studio or Xcode.

---

## 1. What you need

| Tool | Notes |
|---|---|
| **Node.js 20 LTS or newer** | Check with `node -v`. Node 22 is what we use. npm comes with it. |
| **Git** | To get the code. |
| **Expo Go** on your phone | Install from the Play Store (Android) or App Store (iOS). It must be a version that supports **SDK 58**. If Expo Go says the project is incompatible, update Expo Go. |
| **Supabase URL and publishable key** | See step 3. Ask a teammate if you don't have access to the Supabase dashboard. |

Your phone and computer do **not** need to be on the same Wi-Fi, because we start Expo with `--tunnel` (see step 4).

---

## 2. Install dependencies

From the project folder:

```bash
npm install
```

Only use `npx expo install <package>` when **adding** a new library. It picks the version that matches SDK 58. Plain `npm install <package>` can pull a version that breaks Expo Go.

> **Note:** the code imports `expo-file-system` (offline map tiles, photo uploads), but it is not listed in `package.json` yet. If the bundler says *"Unable to resolve module expo-file-system"*, run:
>
> ```bash
> npx expo install expo-file-system
> ```

---

## 3. Set up the Supabase connection (`.env`)

The app reads two values when it starts (see `src/lib/supabase.js`). If either is missing, the app stops with *"Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_KEY"*.

1. Copy the example file:

   ```bash
   cp .env.example .env
   ```

2. Open `.env` and check it has:

   ```env
   EXPO_PUBLIC_SUPABASE_URL=https://urioaayowijvhwbuxxaj.supabase.co
   EXPO_PUBLIC_SUPABASE_KEY=<publishable key>
   ```

   To find the publishable key, open the [Supabase dashboard](https://supabase.com/dashboard/project/urioaayowijvhwbuxxaj), go to **Project Settings → API Keys**, and copy the key that starts with `sb_publishable_`.

**Never put the secret / `service_role` key in this app.** Anything named `EXPO_PUBLIC_*` gets bundled into the app and anyone with the app can read it. The publishable key is safe to share because the database's row-level security decides what each user can see.

If you change `.env`, restart Expo with `-c` (step 4) so it picks up the new values.

---

## 4. Run the app

```bash
npx expo start -c --tunnel
```

- `-c` clears the Metro cache. Use it the first time and whenever `.env` or packages change.
- `--tunnel` serves the app over the internet, so the phone can reach it from any network. The first time, Expo may ask to install `@expo/ngrok`. Say **yes**.

Once a QR code shows in the terminal:

- **Android:** open **Expo Go** and tap **Scan QR code**.
- **iPhone:** scan the QR with the **Camera** app, then tap the banner to open it in Expo Go.

The first load takes a while because the JavaScript bundle is being built. After that, saving a file reloads the app on the phone. Press `r` in the terminal to reload by hand, or shake the phone to open the dev menu.

---

## 5. Sign in

The login screen has two roles:

- **Resident:** contact number (`09XXXXXXXXX`) + 6-digit PIN. New residents can register from the app.
- **Rescuer:** email + password. Rescuer accounts are **only** created by the municipal admin on the web dashboard (Rescuer Accounts tab). There is no rescuer sign-up in the app, on purpose.

Ask the team for the test logins (we keep them in `TEST_LOGINS.md`, not in this repo).

When the app starts it opens the screen for whoever is signed in: residents go to their home screen, rescuers go to the map.

---

## 6. Project layout

```
src/
  app/                 Screens (Expo Router: every file is a route)
    (auth)/            login, register
    (resident)/        home, evacuate, evacuation map, profile
    (rescuer)/         map, alerts, shelters, home, profile
    _layout.jsx        Root layout (wraps everything in SessionProvider)
    index.jsx          Sends the user to the right portal by role
  components/          Shared UI (SessionProvider, DisasterBanner, offline map, ...)
  lib/                 supabase.js (client), location.js, rescuerFeed.js, mapData.js
  services/            api.js (all Supabase calls), tileDownloader.js (offline map tiles)
  utils/vpi.js         Household vulnerability score (same rules as the web's src/utils/vpi.ts)
  constants/           Colours, typography, Cordova barangay data
```

`App.js` and `index.js` at the root are leftovers from the Expo template. The real entry point is `expo-router/entry` (see `"main"` in `package.json`).

---

## 7. Limits of Expo Go

- **No push notifications.** Remote push does not work in Expo Go on SDK 58. It would need a development build (`npx expo run:android` or `eas build --profile development`). For now, alerts show up while the app is open (live updates from Supabase).
- **Only Expo's built-in native modules work.** If you add a library with its own native code, it will not run in Expo Go. Check before adding one.
- The `android/` folder was generated by an earlier `expo run:android`. You don't need it for Expo Go. Don't edit it by hand. Native settings go in `app.json`.

---

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| "Project is incompatible with this version of Expo Go" | Update Expo Go on the phone (it needs SDK 58). |
| "Missing EXPO_PUBLIC_SUPABASE_URL ..." | `.env` is missing or wrong. Redo step 3, then `npx expo start -c --tunnel`. |
| "Unable to resolve module expo-file-system" | `npx expo install expo-file-system` |
| Tunnel hangs or fails to connect | Stop it (Ctrl+C) and run it again. If it keeps failing, try `npx expo start -c` with the phone on the same Wi-Fi as the computer. |
| Package version warnings | `npx expo install --fix`, then `npx expo-doctor` |
| Location not working | Allow location for Expo Go in the phone's settings. The app uses it for SOS, hazard reports and the nearest evacuation centre. |
| Old code or old `.env` values still showing | Restart with `-c` to clear the cache. |
