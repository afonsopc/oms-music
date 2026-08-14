/**
 * Topbar search with typeahead (plano-uma-so-app 4.3, Search row: "campo
 * persistente na barra de topo mais typeahead por Cmd/Ctrl+K, resultados
 * mistos com etiqueta de tipo, Enter toca"). The dropdown reuses the search
 * feature end to end - the same four queries, the same buildSuggestions
 * ranking, the same SuggestionRow - so the topbar and the search screen can
 * never disagree about what "carlos" suggests. The full results page stays:
 * the last row (and plain Enter with nothing highlighted) lands on it with
 * the query in the URL.
 *
 * Activation semantics are FR-32 verbatim: a song REPLACES the queue with
 * just itself and plays; artists, albums and playlists navigate.
 *
 * The dropdown is plain absolute positioning, not a Modal: react-native-web
 * Modals mount a focus trap, which would steal the caret out of this very
 * field on the first keystroke. Outside clicks close through a document
 * listener scoped to the wrapper div instead.
 *
 * Web-only by construction: only TopBar.tsx (itself web-only) imports this.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextStyle,
} from "react-native";
import { useGlobalSearchParams, usePathname, useRouter } from "expo-router";
import { useSearchArtists } from "@/api/queries/artists";
import { useSearchPlaylists } from "@/api/queries/playlists";
import { useSearchAlbums, useSearchSongs } from "@/api/queries/songs";
import { getTransport } from "@/contracts/transport";
import { SuggestionRow } from "@/features/search";
import {
  albumHitRoute,
  buildSuggestions,
  toAlbumHits,
  type SearchSuggestion,
} from "@/features/search/results";
import { useDebounced } from "@/features/search/useDebounced";
import { useT } from "@/i18n";
import { rememberSearch } from "@/lib/recentSearches";
import { artistRoute, playlistRoute } from "@/lib/routes";
import { useTheme } from "@/theme/provider";
import { heavyShadow, Icon } from "@/ui";
import { registerTopbarSearchFocus } from "./searchFocus";

const MSI = "components.music.MusicSearchInput";

/**
 * Kill the browser's UA focus ring (an ugly rectangle doubled against the
 * pill's rounding); the pill paints its own `ring`-colored border while
 * focused instead. react-native-web forwards outline* straight to CSS, but
 * the RN style union predates the web value "none", hence the cast. This
 * file is web-only, so the prop always lands on a real DOM node.
 */
const NO_UA_OUTLINE = { outlineStyle: "none", outlineWidth: 0 } as unknown as TextStyle;

/**
 * Key + preventDefault, extracted from the RN onKeyPress event. onKeyPress
 * and not onKeyDown on purpose: react-native-web's TextInput installs its
 * OWN onKeyDown (which would silently replace a passed one) and forwards
 * every keydown - arrows and Escape included - through onKeyPress, with
 * preventDefault still wired to the real DOM event.
 */
interface FieldKeyEvent {
  key: string;
  preventDefault: () => void;
}

export const TopBarSearch = () => {
  const { tokens } = useTheme();
  const t = useT();
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // On the /search page this field IS the page's input (the desktop page
  // renders no field of its own), so a query arriving through the URL - a
  // direct link, back/forward, a fresh load - must land in here too.
  const pathname = usePathname();
  const routeParams = useGlobalSearchParams<{ query?: string | string[] }>();
  const rawRouteQuery = Array.isArray(routeParams.query)
    ? routeParams.query[0]
    : routeParams.query;
  const routeQuery = pathname === "/search" ? (rawRouteQuery ?? "") : null;

  const [text, setText] = useState(routeQuery ?? "");
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);

  // Later URL changes sync in through adjust-state-during-render, the
  // repo's documented pattern for "a prop moved".
  const [seenRouteQuery, setSeenRouteQuery] = useState(routeQuery);
  if (routeQuery !== seenRouteQuery) {
    setSeenRouteQuery(routeQuery);
    // Leaving /search (null) keeps whatever was typed; only a real query
    // syncs in, and never while the user is mid-edit in the field.
    if (routeQuery !== null && routeQuery.length > 0 && !focused && routeQuery !== text) {
      setText(routeQuery);
    }
  }

  const term = useDebounced(text).trim();
  const enabled = open && term.length > 0;

  const songsQuery = useSearchSongs(term, enabled);
  const artistsQuery = useSearchArtists(term, enabled);
  const albumsQuery = useSearchAlbums(term, enabled);
  const playlistsQuery = useSearchPlaylists(term, enabled);

  const suggestions: SearchSuggestion[] = useMemo(
    () =>
      enabled
        ? buildSuggestions({
            songs: songsQuery.data ?? [],
            directArtists: artistsQuery.data ?? [],
            albums: toAlbumHits(albumsQuery.data ?? [], term),
            playlists: playlistsQuery.data ?? [],
          })
        : [],
    [enabled, songsQuery.data, artistsQuery.data, albumsQuery.data, playlistsQuery.data, term],
  );

  // The keyboard cursor resets when the term changes - adjust-state-during-
  // render, the repo's documented pattern for "a prop/derivation moved".
  const [seenTerm, setSeenTerm] = useState(term);
  if (seenTerm !== term) {
    setSeenTerm(term);
    setHighlight(0);
  }

  // Cmd/Ctrl+K lands here (searchFocus registry).
  useEffect(() => {
    registerTopbarSearchFocus(() => {
      inputRef.current?.focus();
      setOpen(true);
    });
    return () => registerTopbarSearchFocus(null);
  }, []);

  // Outside click closes. Document-level on purpose: blur cannot do this
  // job, because pressing a suggestion blurs the field BEFORE the press
  // lands and would close the dropdown under the finger.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const wrapper = wrapperRef.current;
      if (wrapper && event.target instanceof Node && !wrapper.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = (): void => {
    setOpen(false);
    inputRef.current?.blur();
  };

  const openFullResults = (): void => {
    if (!term) return;
    rememberSearch(term);
    close();
    router.push({ pathname: "/(main)/(tabs)/search", params: { query: term } });
  };

  const activate = (suggestion: SearchSuggestion): void => {
    if (term) rememberSearch(term);
    switch (suggestion.kind) {
      // FR-32: a song becomes a queue of exactly one and plays.
      case "song":
        getTransport().setQueue([suggestion.song], 0, { shuffle: false });
        setOpen(false);
        return;
      case "artist":
        close();
        router.push(artistRoute(suggestion.entry.segment));
        return;
      case "album":
        close();
        router.push(albumHitRoute(suggestion.album));
        return;
      case "playlist":
        close();
        router.push(playlistRoute(suggestion.playlist.id));
        return;
    }
  };

  // Row count includes the trailing "see all" row once there is a term.
  const rowCount = suggestions.length + (term ? 1 : 0);

  const onFieldKeyDown = (event: FieldKeyEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (!open || rowCount === 0) {
      if (event.key === "Enter") {
        event.preventDefault();
        openFullResults();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => Math.min(current + 1, rowCount - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const chosen = suggestions[highlight];
      if (chosen) activate(chosen);
      else openFullResults();
    }
  };

  const isLoading =
    enabled &&
    (songsQuery.isLoading ||
      artistsQuery.isLoading ||
      albumsQuery.isLoading ||
      playlistsQuery.isLoading);

  const showDropdown = open && term.length > 0;
  const seeAllIndex = suggestions.length;

  return (
    // Plain div wrapper: the outside-click listener needs a real DOM node
    // to test containment against, and this file is web-only anyway.
    <div
      ref={wrapperRef}
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 440,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <View
        style={{
          height: 40,
          borderRadius: 20,
          backgroundColor: tokens.secondary,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 14,
          // The pill's own focus treatment (keyboard a11y): the border is
          // always there so focusing never shifts layout, and lights up in
          // the theme's `ring` token - dark ink on the light secondary,
          // light gray on the dark one - when the field has the caret.
          borderWidth: 1,
          borderColor: focused ? tokens.ring : "transparent",
        }}
      >
        <Icon name="search" size={16} color={tokens.mutedForeground} />
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={(value) => {
            setText(value);
            setOpen(true);
          }}
          onFocus={() => {
            setFocused(true);
            setOpen(true);
          }}
          onBlur={() => setFocused(false)}
          onKeyPress={(event) =>
            onFieldKeyDown({
              key: event.nativeEvent.key,
              preventDefault: () => event.preventDefault(),
            })
          }
          // Without this, react-native-web blurs the field on EVERY Enter
          // (its submit path), killing follow-up arrow navigation after
          // playing a song from the dropdown.
          blurOnSubmit={false}
          placeholder={t("components.music.Sidebar.searchMusic")}
          placeholderTextColor={tokens.mutedForeground}
          autoCorrect={false}
          accessibilityLabel={t(`${MSI}.ariaSearch`)}
          style={[{ flex: 1, color: tokens.foreground, fontSize: 14 }, NO_UA_OUTLINE]}
        />
        {text.length > 0 ? (
          <Pressable
            onPress={() => {
              setText("");
              inputRef.current?.focus();
            }}
            accessibilityRole="button"
            accessibilityLabel={t(`${MSI}.clear`)}
            hitSlop={8}
          >
            <Icon name="x" size={14} color={tokens.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      {showDropdown ? (
        <View
          style={[
            {
              position: "absolute",
              top: 44,
              left: 0,
              right: 0,
              zIndex: 100,
              borderRadius: 12,
              backgroundColor: tokens.popover,
              borderWidth: 1,
              borderColor: tokens.border,
              overflow: "hidden",
              maxHeight: 480,
              paddingVertical: 6,
            },
            heavyShadow,
          ]}
        >
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
            {suggestions.map((suggestion, index) => (
              <View
                key={`${suggestion.kind}:${index}`}
                {...{ onMouseEnter: () => setHighlight(index) }}
              >
                <SuggestionRow
                  suggestion={suggestion}
                  highlighted={index === highlight}
                  onSelect={() => activate(suggestion)}
                />
              </View>
            ))}
            {suggestions.length === 0 ? (
              <Text
                style={{
                  color: tokens.mutedForeground,
                  fontSize: 13,
                  paddingHorizontal: 24,
                  paddingVertical: 10,
                }}
              >
                {isLoading ? t(`${MSI}.loading`) : t(`${MSI}.noResults`)}
              </Text>
            ) : null}
            <Pressable
              onPress={openFullResults}
              accessibilityRole="button"
              {...{ onMouseEnter: () => setHighlight(seeAllIndex) }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 24,
                paddingVertical: 10,
                opacity: pressed ? 0.7 : 1,
                backgroundColor: highlight === seeAllIndex ? tokens.secondary : "transparent",
              })}
            >
              <Icon name="search" size={16} color={tokens.mutedForeground} />
              <Text style={{ color: tokens.foreground, fontSize: 13 }} numberOfLines={1}>
                {t(`${MSI}.seeAllResults`, { query: term })}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      ) : null}
    </div>
  );
};
