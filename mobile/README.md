# Flux Browser Mobile

This is a separate iOS/iPadOS and Android browser app built with Expo and the native system WebView. It currently includes address/search navigation, tabs, private tabs, bookmarks, local history, and a Flux home screen. Data is stored locally on the device; cross-device profile sync is not implemented in this mobile app.

## Local development

Install Node.js 22.13 or newer and run `npm ci`, `npx expo install --fix`, `npm run lint`, and `npm run typecheck`, then `npx expo start`. Use a development build for testing native WebView behavior on physical iOS and Android devices.

## Cloud builds

The `eas.json` file defines internal preview and production builds. Sign in to the owner's Expo account, configure the project with `eas project:init`, then build with `eas build --platform all --profile production`. Apple App Store Connect and Google Play Console submission require their respective developer accounts, app records, and signing credentials. The project does not contain these secrets.

The iOS app uses Apple's WebKit-based system WebView. The Android app uses Android System WebView. Store acceptance is subject to each store's review. Apple Vision Pro is not currently a native target; iPad compatibility does not guarantee Vision Pro availability.

## Free Android preview

The repository's Android preview workflow builds an installable APK and publishes it on a GitHub prerelease. It uses Android's debug signing key, so this is for direct preview installs only, not a Google Play production release. No paid developer account is needed to download or install the APK. Mobile profile sync is not included.
