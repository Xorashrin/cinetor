import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Linking, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '../components/Buttons';
import { CinetorMark, Wordmark } from '../components/Logo';
import { Txt } from '../components/Txt';
import { useRootNav } from '../navigation/types';
import { colors, layout, radius } from '../theme/tokens';

const GITHUB_REPO_URL = 'https://github.com/Xorashrin/cinetor';
const MIT_NOTICE = `The MIT License (MIT)

Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export default function AboutScreen() {
  const nav = useRootNav();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [linkError, setLinkError] = useState(false);
  const [showLicense, setShowLicense] = useState(false);
  const gutter = Math.max(layout.gutter, (width - layout.maxContentWidth) / 2);

  const openGitHub = () => {
    setLinkError(false);
    void Linking.openURL(GITHUB_REPO_URL).catch(() => setLinkError(true));
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={[styles.header, { paddingLeft: gutter + insets.left - 8, paddingRight: gutter + insets.right }]}>
        <IconButton icon="arrow-back" onPress={() => nav.goBack()} accessibilityLabel="Go back" />
        <Txt weight="bold" size={22} accessibilityRole="header" style={styles.flex}>About Cinetor</Txt>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingLeft: gutter + insets.left, paddingRight: gutter + insets.right, paddingTop: 16, paddingBottom: insets.bottom + 32 }}>
        <View style={styles.brandCard}>
          <CinetorMark size={64} />
          <View style={styles.wordmark}><Wordmark size={34} /></View>
          <Txt weight="semibold" size={13} color={colors.accent} style={styles.version}>Version 2.0.0</Txt>
          <Txt size={15} color={colors.textMuted} align="center" style={styles.description}>An independent, local-first catalog and media client.</Txt>
        </View>

        <View style={styles.card}>
          <Txt weight="semibold" size={12} color={colors.accent} spacing={1.2} style={styles.eyebrow}>THE PEOPLE</Txt>
          <Txt weight="semibold" size={17} selectable>Developed By: Asraful Islam</Txt>
          <View style={styles.divider} />
          <Txt weight="semibold" size={17} selectable>Contributed By: Sazzad Hossain</Txt>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeading}><Ionicons name="compass-outline" size={22} color={colors.accent} accessible={false} /><Txt weight="bold" size={18} style={styles.flex}>Made to stay organized</Txt></View>
          <Txt color={colors.textMuted} style={styles.paragraph}>Home, Anime, K-Drama, and Others keep their own catalog filters and searches. Profiles is the home for your local profiles, saved titles, Continue Watching, downloads, and settings.</Txt>
          <Txt color={colors.textMuted} style={styles.paragraph}>Catalog entries describe titles. They do not guarantee playback, download availability, stream quality, or permission to access content. Missing metadata remains unknown.</Txt>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeading}><Ionicons name="shield-outline" size={22} color={colors.warning} accessible={false} /><Txt weight="bold" size={18} style={styles.flex}>Build identity & signing</Txt></View>
          <Txt size={13} color={colors.textDim} style={styles.paragraph}>Android package</Txt>
          <Txt size={14} selectable>com.cinator.app</Txt>
          <Txt color={colors.textMuted} style={styles.paragraph}>The legacy Android package is preserved for update compatibility. The display name is Cinetor.</Txt>
          <Txt color={colors.textMuted} style={styles.paragraph}>Compatibility signing uses a debug certificate, not a private distribution key. A compatibility-signed build is not evidence of private production signing.</Txt>
        </View>

        <View style={styles.card}>
          <Txt weight="bold" size={18} accessibilityRole="header">Source & contributions</Txt>
          <Txt color={colors.textMuted} style={styles.paragraph}>Read the source, report an issue, or review the repository's license and notices on GitHub.</Txt>
          <Button label="Open project on GitHub" icon="open-outline" variant="secondary" onPress={openGitHub} accessibilityHint="Opens github.com/Xorashrin/cinetor in your browser" style={styles.action} />
          <Txt size={12} color={colors.textDim} selectable style={styles.paragraph}>{GITHUB_REPO_URL}</Txt>
          {linkError ? <Txt size={13} color={colors.warning} accessibilityLiveRegion="polite" style={styles.paragraph}>The browser could not open this link. You can copy the repository address above.</Txt> : null}
        </View>

        <View style={styles.card}>
          <Txt weight="bold" size={18} accessibilityRole="header">Notices</Txt>
          <Txt color={colors.textMuted} style={styles.paragraph}>Cinetor is an independent project. Content, descriptions, and artwork belong to their respective rightsholders. Use only sources and content you are authorized to access.</Txt>
          <Txt color={colors.textMuted} style={styles.paragraph}>This product uses the TMDB API but is not endorsed or certified by TMDB. Metadata and artwork are not video sources.</Txt>
          <Txt color={colors.textMuted} style={styles.paragraph}>Native Nuvio/Cloudstream components are GPL-3.0; combined distribution includes corresponding source and third-party notices.</Txt>
          <Txt color={colors.textMuted} style={styles.paragraph}>The original Expo MIT notice is retained below. It is not the license for the combined distribution. Dependencies and engine components retain their individual license, attribution, and source-distribution requirements; no blanket license for third-party content is implied.</Txt>
          <Button label={showLicense ? 'Hide original MIT notice' : 'Read original MIT notice'} icon={showLicense ? 'chevron-up' : 'chevron-down'} variant="outline" onPress={() => setShowLicense(value => !value)} style={styles.action} />
          {showLicense ? <Txt size={12} color={colors.textMuted} selectable style={styles.license}>{MIT_NOTICE}</Txt> : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1, minWidth: 0 },
  header: { minHeight: layout.headerHeight, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  brandCard: { backgroundColor: colors.surface1, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.borderSubtle, alignItems: 'center', paddingHorizontal: 24, paddingVertical: 32, marginBottom: 16 },
  wordmark: { marginTop: 16 },
  version: { marginTop: 8 },
  description: { marginTop: 16, maxWidth: 440 },
  card: { padding: 20, marginBottom: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderSubtle, backgroundColor: colors.surface0 },
  eyebrow: { marginBottom: 16 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  paragraph: { marginTop: 12 },
  divider: { height: 1, backgroundColor: colors.borderSubtle, marginVertical: 16 },
  action: { marginTop: 16, alignSelf: 'flex-start' },
  license: { marginTop: 18 },
});
