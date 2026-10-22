import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { MLogo, Wordmark } from '../components/Logo';
import { ScreenHeader } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import { colors, layout, radius } from '../theme/tokens';

const GITHUB_REPO_URL = 'https://github.com/Xorashrin/cinetor';

export default function AboutScreen() {
  const openGitHub = () => {
    Linking.openURL(GITHUB_REPO_URL).catch(() => {});
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="About Cinator" back />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* App Branding Card */}
        <View style={styles.brandCard}>
          <MLogo size={56} />
          <View style={{ marginTop: 14 }}>
            <Wordmark size={32} />
          </View>
          <View style={styles.versionPill}>
            <Txt weight="bold" size={12} color={colors.red}>
              v1.0.2
            </Txt>
            <View style={styles.pillDot} />
            <Txt size={12} color={colors.textDim}>
              Build 3 (Production Release)
            </Txt>
          </View>

          <Txt size={14} color={colors.textMuted} align="center" lineHeight={22} style={{ marginTop: 14 }}>
            Next-generation fast streaming entertainment client featuring isolated feeds for Movies, TV Series,
            Anime, K-Drama, and Live TV channels.
          </Txt>
        </View>

        {/* Development Team */}
        <View style={styles.sectionCard}>
          <Txt weight="bold" size={13} color={colors.textMuted} style={styles.cardHeader}>
            DEVELOPMENT & CONTRIBUTORS
          </Txt>

          <View style={styles.personRow}>
            <View style={[styles.personIconWrap, { backgroundColor: 'rgba(229, 9, 20, 0.15)' }]}>
              <Ionicons name="code-slash" size={20} color={colors.red} />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Txt size={11} color={colors.textDim} weight="bold">
                LEAD DEVELOPER
              </Txt>
              <Txt weight="bold" size={16} color={colors.text} style={{ marginTop: 2 }}>
                Asraful Islam
              </Txt>
            </View>
          </View>

          <View style={styles.innerDivider} />

          <View style={styles.personRow}>
            <View style={[styles.personIconWrap, { backgroundColor: 'rgba(0, 113, 235, 0.15)' }]}>
              <Ionicons name="sparkles" size={20} color={colors.blue} />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Txt size={11} color={colors.textDim} weight="bold">
                CONTRIBUTOR & QA
              </Txt>
              <Txt weight="bold" size={16} color={colors.text} style={{ marginTop: 2 }}>
                Sazzad Hossain
              </Txt>
            </View>
          </View>
        </View>

        {/* Architecture & Core Features */}
        <View style={styles.sectionCard}>
          <Txt weight="bold" size={13} color={colors.textMuted} style={styles.cardHeader}>
            APP ARCHITECTURE
          </Txt>

          <View style={styles.featureItem}>
            <Ionicons name="layers-outline" size={20} color={colors.red} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Txt weight="semibold" size={14} color={colors.text}>
                Strict Feed Isolation
              </Txt>
              <Txt size={12} color={colors.textMuted} style={{ marginTop: 2 }}>
                Dedicated sections for Home, Anime, K-Drama, and Live TV with zero feed contamination.
              </Txt>
            </View>
          </View>

          <View style={styles.innerDivider} />

          <View style={styles.featureItem}>
            <Ionicons name="flash-outline" size={20} color="#F59E0B" />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Txt weight="semibold" size={14} color={colors.text}>
                High-Performance Native Video
              </Txt>
              <Txt size={12} color={colors.textMuted} style={{ marginTop: 2 }}>
                Hardware-accelerated playback with gesture controls, multi-quality streams, and resume support.
              </Txt>
            </View>
          </View>

          <View style={styles.innerDivider} />

          <View style={styles.featureItem}>
            <Ionicons name="hardware-chip-outline" size={20} color="#10B981" />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Txt weight="semibold" size={14} color={colors.text}>
                Universal Multi-Architecture
              </Txt>
              <Txt size={12} color={colors.textMuted} style={{ marginTop: 2 }}>
                Native binary optimizations for arm64-v8a, armeabi-v7a, and x86_64 Android devices.
              </Txt>
            </View>
          </View>
        </View>

        {/* Open Source / GitHub Action */}
        <View style={styles.sectionCard}>
          <Txt weight="bold" size={13} color={colors.textMuted} style={styles.cardHeader}>
            OPEN SOURCE & REPOSITORY
          </Txt>
          <Txt size={13} color={colors.textMuted} lineHeight={19}>
            Cinator is actively maintained. Report issues, contribute features, or check updates directly on GitHub.
          </Txt>

          <Pressable onPress={openGitHub} style={({ pressed }) => [styles.githubBtn, pressed && { opacity: 0.85 }]}>
            <Ionicons name="logo-github" size={20} color={colors.text} />
            <Txt weight="bold" size={14} color={colors.text} style={{ marginLeft: 10 }}>
              github.com/Xorashrin/cinetor
            </Txt>
            <Ionicons name="open-outline" size={16} color={colors.textDim} style={{ marginLeft: 8 }} />
          </Pressable>
        </View>

        {/* Footer Note */}
        <View style={styles.footerWrap}>
          <Txt size={12} color={colors.textDim} align="center">
            Designed for mobile entertainment enthusiasts.
          </Txt>
          <Txt size={11} color="rgba(255,255,255,0.25)" align="center" style={{ marginTop: 4 }}>
            Cinator © {new Date().getFullYear()} • All rights reserved.
          </Txt>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    paddingHorizontal: layout.gutter + 4,
    paddingTop: 8,
    paddingBottom: 48,
  },
  brandCard: {
    backgroundColor: colors.surface1,
    borderRadius: radius.xl,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 16,
  },
  versionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface2,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  pillDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textDim,
    marginHorizontal: 8,
  },
  sectionCard: {
    backgroundColor: colors.surface1,
    borderRadius: radius.lg,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 16,
  },
  cardHeader: {
    marginBottom: 14,
    letterSpacing: 0.5,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  personIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 12,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 2,
  },
  githubBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface3,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    marginTop: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  footerWrap: {
    marginTop: 12,
    alignItems: 'center',
  },
});
