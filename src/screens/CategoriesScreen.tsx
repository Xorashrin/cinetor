import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { PickerList } from '../components/ListItems';
import { HOME_GENRES } from '../data/mock';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'Categories'>;

const HOME = 'All';

export default function CategoriesScreen({ navigation, route }: Props) {
  const current = route.params?.current ?? HOME;
  const targetTab = route.params?.targetTab ?? 'Home';

  const options = React.useMemo(() => {
    if (targetTab === 'Anime') {
      return [HOME, 'My List', 'Action', 'Shonen', 'Fantasy', 'Romance', 'Sci-Fi'];
    }
    if (targetTab === 'KDrama') {
      return [HOME, 'My List', 'Romance', 'Thriller', 'Mystery', 'Comedy', 'Drama'];
    }
    return [HOME, 'My List', ...HOME_GENRES];
  }, [targetTab]);

  return (
    <View style={styles.root}>
      <PickerList
        options={options}
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
