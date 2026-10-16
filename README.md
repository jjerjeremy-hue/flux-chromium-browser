# Flux Browser

Flux is a Chromium-based desktop browser with isolated profiles, Chrome import for bookmarks, browsing history, homepage and search preference, WebDAV sync, a custom home page, and an optional ChatGPT side panel. Saved passwords and website sign-ins are not imported.

## Downloads

- **Windows x64:** [Flux Browser 1.1.0 ZIP](https://github.com/jjerjeremy-hue/flux-chromium-browser/releases/download/v1.1.0/Flux-Windows-x64-v1.1.0.zip)
- **macOS:** 1.2.0 builds are configured for Intel and Apple Silicon in GitHub Actions. They are not available until the release workflow completes. Builds will be unsigned unless signing credentials are configured.
- **Linux x64:** AppImage and Debian packages are configured in GitHub Actions; not available until the release workflow completes.
- **iPhone/iPad and Android:** a separate Expo mobile browser is in development under [`mobile/`](mobile/). Store builds and publication are not complete.
- **Apple Vision Pro:** availability is not confirmed; this project does not currently provide a native visionOS build.

## Build desktop packages

Requires Node.js 24. Install dependencies with `npm ci`, then use `npm run dist:win`, `npm run dist:mac`, or `npm run dist:linux` on the matching OS. The GitHub Actions workflow builds each supported desktop platform and creates a release when a `v1.2.*` tag is pushed.

## Mobile app

See [`mobile/README.md`](mobile/README.md) for development and EAS build configuration. EAS cloud builds and app-store uploads require the owner's Expo, Apple Developer, and Google Play Console accounts and signing credentials. No credentials are stored in this repository.
