/**
 * O painel "Montagem" na gaveta do visualizador (montageSlot): temas (e, na
 * web e no computador, links), o estilo e "Fazer". Mostra uma lista de passos
 * com progresso suave enquanto junta os clipes e corta ao ritmo; a montagem
 * começa a passar assim que há clipes e fica guardada para esta música.
 * Nas apps da loja só usa a biblioteca de clipes (clipSource.ts).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { GhostIconButton } from "@/ui";
import type { MontageStyle } from "../../../montage/protocol";
import { rng } from "../../../montage/timeline";
import type { MontagePanelProps } from "../viz/montageSlot";
import { listClips, montageQueryKey, saveSongMontage, type MontageAnswer } from "./api";
import { canFetchClips, FETCH_COPY, getClipFetch, startClipFetch } from "./clipSource";
import { COPY } from "./copy";
import { setLiveMontage, setMontageOn, useMontageState } from "./store";
import { specFrom, useSavedMontage } from "./useCurrentMontage";

type StepState = "todo" | "doing" | "done";
interface Step {
  key: string;
  label: string;
  state: StepState;
  /** Quanto se espera que demore (para o progresso fingido). */
  expectMs: number;
}

const newSeed = () => 1 + Math.floor(Math.random() * 2_000_000_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STYLES: MontageStyle[] = ["fast", "slow", "chaos"];

/** Uma barra que avança sozinha (depressa no início, cada vez mais devagar) até 90 %, e acaba quando o passo acaba. */
const EasedBar = ({ state, expectMs }: { state: StepState; expectMs: number }) => {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (state === "doing") {
      Animated.timing(v, { toValue: 0.9, duration: expectMs, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    } else if (state === "done") {
      Animated.timing(v, { toValue: 1, duration: 250, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
    } else v.setValue(0);
  }, [state, expectMs, v]);
  if (state === "todo") return null;
  return (
    <View style={{ height: 2, backgroundColor: "#262626", borderRadius: 1, marginTop: 6, overflow: "hidden" }}>
      <Animated.View style={{ height: 2, backgroundColor: state === "done" ? "#737373" : "#fafafa", width: v.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }} />
    </View>
  );
};

const Dot = ({ state }: { state: StepState }) => {
  const [pulse] = useState(() => new Animated.Value(0.35));
  useEffect(() => {
    if (state !== "doing") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state, pulse]);
  if (state === "done") return <Text style={{ color: "#a3a3a3", fontSize: 13, width: 16 }}>✓</Text>;
  return (
    <Animated.View
      style={{ width: 7, height: 7, borderRadius: 4, marginHorizontal: 4, backgroundColor: state === "doing" ? "#fafafa" : "#404040", opacity: state === "doing" ? pulse : 1 }}
    />
  );
};

/** Um painel novo por música (o formulário e a lista de passos recomeçam). */
export const MontagePanel = (props: MontagePanelProps) => <Panel key={props.song ? String(props.song.id) : "none"} {...props} />;

const Panel = ({ song, onClose }: MontagePanelProps) => {
  const locale = useLocale();
  const c = COPY[locale] ?? COPY.pt;
  const f = FETCH_COPY[locale] ?? FETCH_COPY.pt;
  const qc = useQueryClient();
  const songId = song ? String(song.id) : null;
  const saved = useSavedMontage(songId);
  const { on, live } = useMontageState();
  const savedMontage = saved.data?.montage ?? null;
  const [input, setInput] = useState("");
  const [style, setStyle] = useState<MontageStyle>("fast");
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useRef(0);

  // O que está guardado para esta música enche o formulário (uma vez, quando chega).
  const [filledFrom, setFilledFrom] = useState<typeof savedMontage>(null);
  if (savedMontage && savedMontage !== filledFrom) {
    setFilledFrom(savedMontage);
    setStyle(savedMontage.style);
    if (savedMontage.themes.length && !input) setInput(savedMontage.themes.join(", "));
  }

  const mark = (key: string, state: StepState, label?: string) =>
    setSteps((list) => list?.map((s) => (s.key === key ? { ...s, state, label: label ?? s.label } : s)) ?? null);

  /** Guarda (núcleo), mete na cache e passa-a já. */
  const apply = useCallback(
    async (ids: number[], seed: number, st: MontageStyle, themes: string[]): Promise<MontageAnswer | null> => {
      if (!songId || !ids.length) return null;
      const answer = await saveSongMontage(songId, { seed, style: st, themes, clip_ids: ids });
      qc.setQueryData(montageQueryKey(songId), answer);
      setLiveMontage(specFrom(songId, answer));
      setMontageOn(true);
      return answer;
    },
    [songId, qc],
  );

  const make = async () => {
    if (!songId || busy) return;
    haptics.tap();
    const my = ++run.current;
    const seed = newSeed();
    const themes = input.split(/[,\n;]+/).map((s) => s.trim()).filter((s) => s && !/^https?:\/\//i.test(s));
    setBusy(true);
    setNote(null);
    const list: Step[] = canFetchClips
      ? [
          { key: "library", label: c.library, state: "doing", expectMs: 1500 },
          { key: "search", label: f.searching, state: "todo", expectMs: 8000 },
          { key: "download", label: f.downloading(0, 12), state: "todo", expectMs: 240_000 },
          { key: "cut", label: c.cutting, state: "todo", expectMs: 1800 },
        ]
      : [
          { key: "library", label: c.library, state: "doing", expectMs: 1500 },
          { key: "cut", label: c.cutting, state: "todo", expectMs: 1800 },
        ];
    setSteps(list);
    try {
      let ids: number[] = [];
      if (canFetchClips && input.trim()) {
        let { item } = await startClipFetch({ song_id: songId, input, style, seed });
        let shown = 0;
        while (my === run.current) {
          if (item.step && item.step !== "library") mark("library", "done");
          if (item.step === "searching") mark("search", "doing");
          if (item.step === "downloading" || item.state === "done") mark("search", "done");
          if (item.step === "downloading") mark("download", item.planned ? "doing" : "done", f.downloading(Math.min(item.downloaded + 1, item.planned), item.planned));
          // a montagem começa a passar logo que há clipes
          if (item.clip_ids.length >= 3 && item.clip_ids.length !== shown) {
            shown = item.clip_ids.length;
            await apply(item.clip_ids, seed, style, themes);
          }
          if (item.state === "done" || item.state === "failed") break;
          await sleep(1500);
          item = (await getClipFetch(item.id)).item;
        }
        if (my !== run.current) return;
        mark("library", "done");
        mark("search", "done");
        mark("download", "done", item.planned ? f.downloading(item.downloaded, item.planned) : c.nothingNew);
        if (item.error?.startsWith("pause")) setNote(f.paused);
        else if (item.state === "failed") setNote(c.failed);
        else if (item.planned === 0 && item.cached < 3) setNote(f.noneToday);
        ids = item.clip_ids;
        if (ids.length < 3) ids = [...new Set([...ids, ...(await listClips([], 40)).map((x) => x.id)])];
      } else {
        const tags = input.trim() ? themes : [];
        let clips = await listClips(tags, 60);
        if (!clips.length && tags.length) clips = await listClips([], 60);
        // um baralho pela semente: os mesmos clipes não aparecem sempre pela mesma ordem
        const r = rng(seed);
        ids = clips.map((x) => ({ id: x.id, k: r() })).sort((a, b) => a.k - b.k).slice(0, 24).map((x) => x.id);
        mark("library", "done");
        if (!ids.length) {
          setNote(canFetchClips ? c.emptyFetch : c.emptyLibrary);
          setSteps(null);
          return;
        }
      }
      mark("cut", "doing");
      await sleep(700);
      const answer = await apply(ids, seed, style, themes);
      mark("cut", "done", answer ? c.ready(answer.clips.length) : c.cutting);
      haptics.success();
    } catch {
      setNote(c.failed);
    } finally {
      if (my === run.current) setBusy(false);
    }
  };

  const current = live?.songId === songId ? live : songId ? specFrom(songId, saved.data) : null;

  const reshuffle = async () => {
    if (!current || !songId) return;
    haptics.select();
    await apply(current.clips.map((x) => x.id), newSeed(), style, savedMontage?.themes ?? []).catch(() => setNote(c.failed));
  };

  const pickStyle = (st: MontageStyle) => {
    haptics.select();
    setStyle(st);
    if (current && !busy) void apply(current.clips.map((x) => x.id), current.seed, st, savedMontage?.themes ?? []).catch(() => undefined);
  };

  const label = { color: "#a3a3a3", fontSize: 12, fontWeight: "600" as const, letterSpacing: 0.6, textTransform: "uppercase" as const, marginBottom: 8 };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: "#262626" }}>
        <Text style={{ flex: 1, color: "#fafafa", fontSize: 18, fontWeight: "700" }}>{c.title}</Text>
        <GhostIconButton icon="x" color="#fff" accessibilityLabel={c.close} onPress={onClose} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 22 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: "#a3a3a3", fontSize: 14, lineHeight: 20 }}>
          {current ? c.has(current.clips.length) : song ? c.none : c.noSong}
        </Text>

        <View>
          <Text style={label}>{canFetchClips ? c.themesOrLinks : c.themes}</Text>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={f.placeholder}
            placeholderTextColor="#525252"
            multiline
            autoCorrect={false}
            autoCapitalize="none"
            style={{ minHeight: 76, color: "#fafafa", fontSize: 15, lineHeight: 21, borderWidth: 1, borderColor: "#262626", borderRadius: 8, padding: 12, backgroundColor: "#0a0a0a", textAlignVertical: "top" }}
          />
        </View>

        <View>
          <Text style={label}>{c.style}</Text>
          <View style={{ flexDirection: "row", borderWidth: 1, borderColor: "#262626", borderRadius: 8, overflow: "hidden" }}>
            {STYLES.map((st, i) => (
              <Pressable
                key={st}
                accessibilityRole="radio"
                accessibilityState={{ selected: style === st }}
                onPress={() => pickStyle(st)}
                style={({ pressed }) => ({
                  flex: 1,
                  paddingVertical: 10,
                  alignItems: "center",
                  backgroundColor: style === st ? "#262626" : "transparent",
                  borderLeftWidth: i ? 1 : 0,
                  borderColor: "#262626",
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ color: style === st ? "#fafafa" : "#a3a3a3", fontSize: 13, fontWeight: style === st ? "600" : "500" }}>{c.styles[st]}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            accessibilityRole="button"
            disabled={!song || busy}
            onPress={() => void make()}
            style={({ pressed }) => ({ flex: 1, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#fafafa", opacity: !song || busy ? 0.4 : pressed ? 0.8 : 1 })}
          >
            <Text style={{ color: "#0a0a0a", fontSize: 15, fontWeight: "700" }}>{c.make}</Text>
          </Pressable>
          {current ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void reshuffle()}
              style={({ pressed }) => ({ height: 44, paddingHorizontal: 16, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#404040", opacity: pressed ? 0.7 : 1 })}
            >
              <Text style={{ color: "#fafafa", fontSize: 14, fontWeight: "600" }}>{c.another}</Text>
            </Pressable>
          ) : null}
        </View>

        {steps ? (
          <View style={{ gap: 14 }}>
            {steps.map((s) => (
              <View key={s.key}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Dot state={s.state} />
                  <Text style={{ flex: 1, color: s.state === "todo" ? "#525252" : s.state === "done" ? "#a3a3a3" : "#fafafa", fontSize: 14 }}>{s.label}</Text>
                </View>
                <EasedBar state={s.state} expectMs={s.expectMs} />
              </View>
            ))}
          </View>
        ) : null}

        {note ? <Text style={{ color: "#d4d4d4", fontSize: 14, lineHeight: 20 }}>{note}</Text> : null}

        {current ? (
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} onPress={() => { haptics.select(); setMontageOn(!on); }} style={{ paddingVertical: 6 }}>
            <Text style={{ color: "#a3a3a3", fontSize: 14, textDecorationLine: "underline" }}>{on ? c.turnOff : c.turnOn}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
};
