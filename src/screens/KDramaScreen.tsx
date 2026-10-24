import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import React from 'react';

import { CatalogScreen } from '../components/CatalogScreen';
import type { TabParamList } from '../navigation/types';

type Props = BottomTabScreenProps<TabParamList, 'KDrama'>;

export default function KDramaScreen({ route, navigation }: Props) {
  return <CatalogScreen section="kdrama" genre={route.params?.genre} onGenreChange={genre => navigation.setParams({ genre })} />;
}
