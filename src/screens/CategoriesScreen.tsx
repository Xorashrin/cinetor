import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { PickerList } from '../components/ListItems';
import { GENRES } from '../data/mock';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'Categories'>;

const HOME = 'All';

export default function CategoriesScreen({ navigation, route }: Props) {
  const current = route.params?.current ?? HOME;
  const targetTab = route.params?.targetTab ?? 'Home';

  return (
    <View style={styles.root}>
      <PickerList
        options={[HOME, 'My List', ...GENRES]}
        selected={current}
        onClose={() => navigation.goBack()}
        onSelect={(value) => {
          if (value === 'My List') {
            navigation.goBack();
            navigation.navigate('MyList');
            return;
          }
          if (targetTab === 'Anime') {
            navigation.navigate('Main', { screen: 'Anime', params: { genre: value === HOME ? undefined : value } });
          } else if (targetTab === 'KDrama') {
            navigation.navigate('Main', { screen: 'KDrama', params: { genre: value === HOME ? undefined : value } });
          } else {
            navigation.navigate('Main', { screen: 'Home', params: { genre: value === HOME ? undefined : value } });
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.overlay },
});
