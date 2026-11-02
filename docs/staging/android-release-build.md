# Android Build: Status, Configuration and Commands

**Date:** 2026-11-02
**App:** `mobile-app/`, package `com.foodcourt.multistall`, version 1.0.0 (versionCode 1)
**Phase 4 status (2026-11-02):** APK/AAB **NOT BUILT, intentionally postponed**. Target is Expo Go (SDK 57). Verified: `pnpm check-types` (0), `expo config --type public` (0, sdk 57.0.0), `expo install --check` (up to date), `expo-doctor` (21/21), `expo export` (612 modules, no demo credentials in the production bundle). Metro serves the SDK 57 bundle at `exp://10.16.20.53:8081` with `EXPO_PUBLIC_API_URL=http://10.16.20.53:8100/api`. **Not yet loaded on a physical phone.**

**Status:** **No release APK has been produced yet.** The project was upgraded from Expo SDK 52 to **SDK 57** during Phase 3, at the owner's request so it runs in the installed Expo Go (SDK 57). The SDK 57 release build has not been run.

## 1. Stack after the upgrade

| Item | Before | Now |
|---|---|---|
| Expo SDK | 52.0.28 | **57.0.31** |
| React Native | 0.76.7 | **0.86.3** (New Architecture, Android edge-to-edge) |
| React | 18.3.1 | **19.2.3** |
| `@react-native-async-storage/async-storage` | 1.23.1 | 2.2.0 |
| `expo-status-bar` | 2.0.1 | 57.0.1 |
| Added | — | `expo-splash-screen` 57.0.10, `react-native-safe-area-context` 5.7.0 |
| TypeScript / `@types/react` | 5.x / 18.3 | 6.0 / 19.2 |
| Package layout | pnpm isolated | `node-linker=hoisted` (`mobile-app/.npmrc`) |

Code changes the upgrade required:
- `tsconfig.json` now only extends `expo/tsconfig.base` (TS 6 rejects `moduleResolution: node` and `baseUrl`).
- The top-level `splash` key was removed from `app.json` (no longer in the schema) and moved into the `expo-splash-screen` plugin config.
- `App.tsx` uses `SafeAreaProvider`/`SafeAreaView` from `react-native-safe-area-context` and `StatusBar` from `expo-status-bar`. On edge-to-edge Android, React Native's own `SafeAreaView` and `StatusBar backgroundColor` no longer keep content out from under the system bars.

Verification after the upgrade:
- `pnpm check-types` (tsc 6): **0 errors**
- `npx expo-doctor`: **21/21 checks passed**
- `npx expo export --platform android`: **bundled 612 modules** to a 1.7 MB Hermes bundle
- Metro serving the app to Expo Go (SDK 57) on `exp://<pc-lan-ip>:8081`. Opening it on the phone was not observed from here.

## 2. Release configuration (`app.json`)

| Check | Value | Notes |
|---|---|---|
| Package id | `com.foodcourt.multistall` | |
| Permissions | `INTERNET`, `ACCESS_NETWORK_STATE` | RECORD_AUDIO, SYSTEM_ALERT_WINDOW and external storage are blocked. React Native adds VIBRATE. |
| Cleartext HTTP | Enabled by `plugins/withLanCleartext.js` | **Required**: the edge server is plain HTTP on the LAN, and Android release builds block cleartext by default |
| Icons / splash | `icon.png` 1024², `adaptive-icon.png` 1024², `splash.png` 2048² (plugin `imageWidth` 200) | |
| API base URL | Set on the login screen: *Configure Edge Server IP / LAN* → `http://<edge-ip>:<port>/api` | Default `http://10.0.2.2:8000/api` only works on an emulator |
| Demo logins | Shown only when `__DEV__` (Expo Go / debug). Hidden in release builds | |

## 3. Build history in Phase 3 (SDK 52, superseded)

1. `expo prebuild` + `gradlew assembleRelease`. Gradle downloaded about 6 GB of dependencies, then **failed after 16 m 37 s** at `:expo-constants:createExpoConfig`: `withLanCleartext.js` required `@expo/config-plugins`, which pnpm (isolated layout) did not expose to the project.
2. Fix: require `expo/config-plugins` (a direct dependency) and use the hoisted layout.
3. The rebuild was stopped when the owner asked for the SDK 57 upgrade. The SDK 52 `android/` folder was deleted (it is generated and git-ignored).

## 4. Commands to produce and verify the release APK (SDK 57)

```powershell
cd mobile-app
pnpm install                                   # pnpm 10.x, hoisted layout via .npmrc
npx expo prebuild --platform android --clean   # regenerates android/ for SDK 57
cd android
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat assembleRelease
# output: android\app\build\outputs\apk\release\app-release.apk
& "$env:ANDROID_HOME\platform-tools\adb.exe" install -r app\build\outputs\apk\release\app-release.apk
```

Then on the device: set the edge server URL, log in as a waiter and a kitchen user, and run UAT-W-01…W-08 and UAT-K-01…K-05 (`uat-test-plan.md`).

**Signing:** the generated project signs `release` with the debug keystore. Before distributing to staff devices, create a release keystore, store it outside the repository, and configure `signingConfigs.release` (or use EAS Build with managed credentials) (OPEN-13).

## 5. Environment notes
- JDK 17 and Android SDK platforms 36/37 with build-tools 35/36 are installed. Check that the SDK 57 Gradle plugin's required compile SDK is present when running `prebuild`.
- A physical device (`ZN4223FC6T`) was visible to `adb`, but `adb shell` commands hung (likely an authorisation prompt on the device). The `Medium_Phone_API_37.0` emulator shut down about a minute after starting.
