import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import React from 'react';

import { CatalogScreen } from '../components/CatalogScreen';
import type { TabParamList } from '../navigation/types';

type Props = BottomTabScreenProps<TabParamList, 'Home'>;

export default function HomeScreen({ route, navigation }: Props) {
  return <CatalogScreen section="home" genre={route.params?.genre} onGenreChange={genre => navigation.setParams({ genre })} />;
}
