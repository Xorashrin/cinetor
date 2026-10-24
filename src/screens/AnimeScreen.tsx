import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import React from 'react';

import { CatalogScreen } from '../components/CatalogScreen';
import type { TabParamList } from '../navigation/types';

type Props = BottomTabScreenProps<TabParamList, 'Anime'>;

export default function AnimeScreen({ route, navigation }: Props) {
  return <CatalogScreen section="anime" genre={route.params?.genre} onGenreChange={genre => navigation.setParams({ genre })} />;
}
