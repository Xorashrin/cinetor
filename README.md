# Cinator

A Netflix-style streaming app UI for Android (React Native + Expo SDK 58), completely clean and blank without mock data or external APIs.

## Tabs
- **Home**: Curated main entertainment view.
- **Anime**: Dedicated anime section with category filters (Shonen, Action, Fantasy, Romance, Sci-Fi).
- **K-Drama**: Dedicated Korean drama section with filters (Romance, Thriller, Mystery, Comedy, Drama).
- **Profiles**: Profile switcher, avatar management, My List, Downloads, and App Settings.

## Build (GitHub Actions)

1. Pushing to `main` automatically triggers the `.github/workflows/android.yml` action.
2. In your GitHub repository, open **Actions → Android APK**.
3. When the build finishes, download the `cinator-apk` artifact.
4. Install the release APK on your Android device.

## Project Layout

```
App.tsx                 Fonts, splash, providers, navigation container
src/theme/tokens.ts     Colors, spacing, typography, motion tokens
src/data/               Data structures and types
src/state/AppState.tsx  App state + AsyncStorage persistence
src/navigation/         Root stack + bottom tabs (Home, Anime, K-Drama, Profiles)
src/components/         Shared UI components
src/screens/            Individual screen components
```
