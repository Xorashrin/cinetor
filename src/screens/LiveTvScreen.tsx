import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  AppState,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type ListRenderItem,
} from "react-native";

import { ChannelLogo } from "../components/ChannelLogo";
import { Chip } from "../components/Chip";
import { ScreenHeader } from "../components/ScreenHeader";
import { Txt } from "../components/Txt";
import { ADULT_CHANNELS, type AdultChannel } from "../data/adultChannels";
import {
  CHANNEL_FILTERS,
  filterChannels,
  type Channel,
} from "../data/channels";
import type { RootStackParamList } from "../navigation/types";
import { useApp } from "../state/AppState";
import { PosterRow } from "../components/Rows";
import { toTitle } from "../engine/ui";
import { catalog, scheduler } from "../engine/runtime";
import { allowAdultSession } from "../engine/runtime";
import { colors, layout, radius } from "../theme/tokens";

type Props = {
  navigation: any;
  route?: any;
};
type ActiveSection = "general" | "adult";

const COLUMNS = 3;

export default function LiveTvScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const { catalogVersion } = useApp();
  const [activeSection, setActiveSection] = useState<ActiveSection>("general");
  const [filter, setFilter] = useState("All");
  const [adultUnlocked, setAdultUnlocked] = useState(false);

  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        setAdultUnlocked(false);
        setActiveSection("general");
      }
    });
    return () => listener.remove();
  }, []);
  const channels = useMemo(
    () => filterChannels(filter),
    [filter, catalogVersion],
  );
  const adultTitles = useMemo(
    () =>
      adultUnlocked && scheduler.adultAccess
        ? []
        : [],
    [adultUnlocked, catalogVersion],
  );
  const cell = Math.floor(
    (width - layout.gutter * 2 - 8 * (COLUMNS - 1)) / COLUMNS,
  );

  const handleSelectSection = (section: ActiveSection) => {
    if (section === "adult" && (!adultUnlocked || !scheduler.adultAccess)) {
      Alert.alert(
        "18+ Adult Content Section",
        "This section contains adult streams and is strictly intended for individuals aged 18 and older. It is completely isolated from all other feeds. Do you confirm you are 18+?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "I am 18+ (Proceed)",
            style: "destructive",
            onPress: () => {
              setAdultUnlocked(true);
              allowAdultSession();
              setActiveSection("adult");
            },
          },
        ],
      );
      return;
    }
    setActiveSection(section);
  };

  const renderChannelItem = useCallback<ListRenderItem<Channel>>(
    ({ item }) => (
      <Pressable
        onPress={() =>
          navigation.navigate("Live", { channelId: item.id, filter })
        }
        style={({ pressed }) => [{ width: cell, opacity: pressed ? 0.7 : 1 }]}
      >
        <ChannelLogo channel={item} size={cell} />
        <Txt
          weight="medium"
          size={12}
          numberOfLines={1}
          style={{ marginTop: 6 }}
        >
          {item.name}
        </Txt>
        <View style={styles.meta}>
          <View style={styles.liveDot} />
          <Txt size={10} color={colors.textDim} numberOfLines={1}>
            {item.category}
            {item.quality ? ` • ${item.quality}` : ""}
          </Txt>
        </View>
      </Pressable>
    ),
    [cell, navigation, filter],
  );

  const renderAdultItem = useCallback<ListRenderItem<AdultChannel>>(
    ({ item }) => (
      <Pressable
        onPress={() => navigation.navigate("Live", { channelId: item.id })}
        style={({ pressed }) => [styles.adultCard, pressed && { opacity: 0.8 }]}
      >
        <View style={styles.adultBadge}>
          <Txt weight="black" size={11} color={colors.text}>
            18+
          </Txt>
        </View>
        <View style={styles.adultIconWrap}>
          <Ionicons name="flame" size={36} color={colors.red} />
        </View>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Txt weight="bold" size={15} numberOfLines={1}>
            {item.name}
          </Txt>
          <Txt size={12} color={colors.textDim} style={{ marginTop: 2 }}>
            {item.category} • {item.quality}
          </Txt>
        </View>
        <View style={styles.playIconWrap}>
          <Ionicons name="play" size={18} color={colors.text} />
        </View>
      </Pressable>
    ),
    [navigation],
  );

  const canGoBack = Boolean(navigation?.canGoBack && navigation.canGoBack());

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Live TV Directory"
        back={canGoBack}
        actions={["search"]}
      />

      {/* Isolated Section Switcher */}
      <View style={styles.sectionSwitcher}>
        <Pressable
          onPress={() => handleSelectSection("general")}
          style={[
            styles.switchBtn,
            activeSection === "general" && styles.switchBtnActive,
          ]}
        >
          <Ionicons
            name="tv-outline"
            size={16}
            color={activeSection === "general" ? colors.text : colors.textDim}
          />
          <Txt
            weight={activeSection === "general" ? "bold" : "medium"}
            size={13}
            color={activeSection === "general" ? colors.text : colors.textDim}
            style={{ marginLeft: 6 }}
          >
            General Live TV
          </Txt>
        </Pressable>

        <Pressable
          onPress={() => handleSelectSection("adult")}
          style={[
            styles.switchBtn,
            activeSection === "adult" && styles.switchBtnAdultActive,
          ]}
        >
          <Ionicons
            name="shield-outline"
            size={16}
            color={activeSection === "adult" ? colors.text : colors.textDim}
          />
          <Txt
            weight={activeSection === "adult" ? "bold" : "medium"}
            size={13}
            color={activeSection === "adult" ? colors.text : colors.textDim}
            style={{ marginLeft: 6 }}
          >
            Adult Content [18+]
          </Txt>
        </Pressable>
      </View>

      {activeSection === "general" ? (
        <>
          <View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              {CHANNEL_FILTERS.map((f) => (
                <Chip
                  key={f}
                  label={f}
                  selected={filter === f}
                  solid
                  onPress={() => setFilter(f)}
                />
              ))}
            </ScrollView>
          </View>
          <FlatList
            key={filter}
            extraData={catalogVersion}
            data={channels}
            keyExtractor={(c) => c.id}
            numColumns={COLUMNS}
            renderItem={renderChannelItem}
            columnWrapperStyle={styles.row}
            contentContainerStyle={styles.grid}
            initialNumToRender={18}
            maxToRenderPerBatch={18}
            windowSize={7}
            removeClippedSubviews
            ListHeaderComponent={
              <Txt size={12} color={colors.textDim} style={styles.count}>
                {channels.length} channels in the directory
              </Txt>
            }
          />
        </>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={styles.isolatedNotice}>
            <Ionicons name="lock-closed" size={16} color={colors.red} />
            <Txt
              size={12}
              color={colors.textSoft}
              style={{ marginLeft: 8, flex: 1 }}
            >
              Isolated Feed: This section is strictly separate and isolated from
              the rest of the application.
            </Txt>
          </View>

          <FlatList
            ListHeaderComponent={
              adultTitles.length ? (
                <PosterRow
                  title="Movies & Series (18+)"
                  items={adultTitles}
                  onPressTitle={(title) =>
                    navigation.navigate("Title", { id: title.id })
                  }
                />
              ) : undefined
            }
            extraData={catalogVersion}
            data={ADULT_CHANNELS}
            keyExtractor={(item) => item.id}
            renderItem={renderAdultItem}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingBottom: 40,
              paddingTop: 10,
            }}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  sectionSwitcher: {
    flexDirection: "row",
    marginHorizontal: 12,
    marginVertical: 10,
    backgroundColor: colors.surface1,
    borderRadius: radius.md,
    padding: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
  },
  switchBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  switchBtnActive: { backgroundColor: colors.surface3 },
  switchBtnAdultActive: { backgroundColor: colors.red },
  chips: { paddingHorizontal: 12, paddingBottom: 10, gap: 8 },
  grid: { paddingHorizontal: 12, paddingBottom: 40 },
  row: { gap: 8, marginBottom: 14 },
  count: { marginBottom: 10, paddingHorizontal: 2 },
  meta: { flexDirection: "row", alignItems: "center", marginTop: 3 },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.red,
    marginRight: 5,
  },
  isolatedNotice: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: colors.surface2,
    padding: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(229,9,20,0.3)",
  },
  adultCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface2,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
  },
  adultBadge: {
    backgroundColor: colors.red,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 6,
  },
  adultIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  playIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface4,
    alignItems: "center",
    justifyContent: "center",
  },
});
