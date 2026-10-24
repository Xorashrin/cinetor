import { useNavigation, type NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { CatalogSection } from '../engine/contracts';

export type TabParamList = {
  Home: { genre?: string } | undefined;
  Anime: { genre?: string } | undefined;
  KDrama: { genre?: string } | undefined;
  Others: { genre?: string } | undefined;
  Profiles: undefined;
};

export type RootStackParamList = {
  Splash: undefined;
  Main: NavigatorScreenParams<TabParamList> | undefined;
  Title: { id: string };
  Player: { id: string; episodeId?: string };
  Live: { channelId: string; filter?: string };
  LiveTv: undefined;
  Search: { section?: CatalogSection } | undefined;
  Categories: { current?: string; targetTab?: 'Home' | 'Anime' | 'KDrama' } | undefined;
  MyList: undefined;
  Downloads: undefined;
  Notifications: undefined;
  AppSettings: undefined;
  Providers: undefined;
  Repositories: undefined;
  ManageProfiles: undefined;
  AdultContent: undefined;
  ImportExport: undefined;
  About: undefined;
};

export type RootNav = NativeStackNavigationProp<RootStackParamList>;

export function useRootNav(): RootNav {
  return useNavigation<RootNav>();
}
