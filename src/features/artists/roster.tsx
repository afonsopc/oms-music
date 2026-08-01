/**
 * Artists roster (FR-37): the A-Z grid. Infinite 60-per-page scroll, a sort
 * toggle that RESTARTS the infinite query (different query key, so pages are
 * never mixed across orders), and a debounced server-side search that
 * REPLACES the grid while it has text - searching asks the server rather
 * than narrowing the pages that happen to be loaded, so a match further down
 * the alphabet is still found.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useArtistsRoster, useArtistsSearch } from "@/api/queries/artists";
import type { ArtistsRosterOrder } from "@/api/endpoints/artists";
import type { Artist } from "@/domain/artist";
import { artistImageSource } from "@/domain/artwork";
import { useT } from "@/i18n";
import { artistRoute } from "@/lib/routes";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ArtistCard, CircleSkeleton, EmptyState, ErrorState, FilterPills, Icon, Skeleton } from "@/ui";
import { useContentBottomPadding } from "@/features/shell/metrics";

const SEARCH_DEBOUNCE_MS = 250;
const SKELETON_COUNT = 12;

type Sort = "alphabetical" | "recent";

const ORDER_BY_SORT: Record<Sort, ArtistsRosterOrder> = {
  alphabetical: "name:asc",
  recent: "created_at:desc",
};

const columnsForWidth = (width: number): number =>
  width >= 1024 ? 5 : width >= 768 ? 4 : width >= 520 ? 3 : 2;

export default function ArtistsRosterScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const bottomPadding = useContentBottomPadding();

  const [sort, setSort] = useState<Sort>("alphabetical");
  const [filter, setFilter] = useState("");
  const [debouncedFilter, setDebouncedFilter] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFilter(filter.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filter]);

  const isFiltering = debouncedFilter.length > 0;
  const rosterQuery = useArtistsRoster(ORDER_BY_SORT[sort], !isFiltering);
  const searchQuery = useArtistsSearch(debouncedFilter, isFiltering);

  const roster = useMemo<Artist[]>(
    () => rosterQuery.data?.pages.flat() ?? [],
    [rosterQuery.data],
  );
  const visible = isFiltering ? (searchQuery.data ?? []) : roster;

  const columns = columnsForWidth(width);
  const cardSize = Math.max(72, Math.floor((width - 40 - columns * 8) / columns) - 16);

  const renderItem = useCallback(
    ({ item }: { item: Artist }) => (
      <View style={{ flex: 1 / columns, alignItems: "center", paddingVertical: 8 }}>
        <ArtistCard
          name={item.name}
          image={artistImageSource(item, "sm")}
          size={cardSize}
          onPress={() => router.push(artistRoute(item.slug || item.name))}
        />
      </View>
    ),
    [columns, cardSize, router],
  );

  const loading = isFiltering ? searchQuery.isLoading : rosterQuery.isLoading;
  const errored = isFiltering ? searchQuery.isError : rosterQuery.isError;

  const empty = loading ? (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        rowGap: 16,
      }}
    >
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <View key={i} style={{ width: `${100 / columns}%`, alignItems: "center", gap: 8 }}>
          <CircleSkeleton size={cardSize} />
          <Skeleton width={Math.round(cardSize * 0.7)} height={12} />
        </View>
      ))}
    </View>
  ) : errored ? (
    <ErrorState
      text={t("components.music.Artists.errorLoadingArtists")}
      onRetry={() =>
        void (isFiltering ? searchQuery.refetch() : rosterQuery.refetch())
      }
    />
  ) : (
    <EmptyState
      icon="user"
      text={
        isFiltering
          ? t("components.music.Artists.noArtistsForFilter")
          : t("components.music.Artists.noArtistsFound")
      }
    />
  );

  const header = (
    <View style={{ gap: 12, paddingBottom: 12 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderWidth: 1,
          borderColor: tokens.input,
          borderRadius: RADIUS,
          paddingHorizontal: 12,
          backgroundColor: tokens.secondary,
        }}
      >
        <Icon name="search" size={16} color={tokens.mutedForeground} />
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder={t("components.music.Artists.filterPlaceholder")}
          placeholderTextColor={tokens.mutedForeground}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel={t("components.music.Artists.filterPlaceholder")}
          style={{ flex: 1, paddingVertical: 10, color: tokens.foreground, fontSize: 15 }}
        />
      </View>
      <FilterPills
        pills={[
          { key: "alphabetical", label: t("components.music.Artists.sortAlphabetical") },
          { key: "recent", label: t("components.music.Artists.sortRecentlyAdded") },
        ]}
        activeKey={sort}
        onChange={(key) => setSort(key as Sort)}
        scrollable={false}
      />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <FlatList
        // numColumns cannot change on a mounted list; remount on rotation.
        key={`cols-${columns}`}
        data={visible}
        renderItem={renderItem}
        keyExtractor={(item) => String(item.id)}
        numColumns={columns}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          !isFiltering && rosterQuery.isFetchingNextPage ? (
            <View style={{ paddingVertical: 16 }}>
              <ActivityIndicator />
            </View>
          ) : null
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (isFiltering) return;
          if (rosterQuery.hasNextPage && !rosterQuery.isFetchingNextPage) {
            void rosterQuery.fetchNextPage();
          }
        }}
        initialNumToRender={24}
        windowSize={9}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: bottomPadding,
        }}
      />
    </View>
  );
}
