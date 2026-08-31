/**
 * Canonical song menu renderer (FR-74 render half). Renders the frozen
 * slot order from contracts/songMenu; registered slot hooks provide the
 * items, unregistered slots render nothing, so the menu is byte-identical
 * on every surface. Two renderer-owned pieces:
 *
 * - `surfaceExtras`: items injected by the surface through the context are
 *   rendered in their frozen position alongside any registered hook items.
 * - `viewCredits`: the credits dialog is WP4's deliverable (FR-125); when
 *   no hook is registered for the slot, a built-in item opens the
 *   internally hosted SongCreditsDialog (only when `song.artists` is
 *   non-empty, per the frozen condition).
 *
 * Each slot is isolated in its own component so the rules of hooks hold
 * for slot implementations that subscribe to stores.
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { isDjClip } from "@/domain/song";
import { ArtworkImage } from "./ArtworkImage";
import { SongCreditsDialog } from "./dialogs/SongCreditsDialog";
import { SongMatchDialog } from "./dialogs/SongMatchDialog";
import { Icon, iconForHint } from "./icons";
import { Popover } from "./Popover";
import type { PopoverAnchor } from "./popoverPosition";
import { useDesktopShell } from "./shellLayout";
import { BottomSheet } from "./sheets/BottomSheet";
import {
  getSongMenuSlot,
  SONG_MENU_SLOT_ORDER,
  type SongMenuContext,
  type SongMenuItem,
  type SongMenuSlotHook,
  type SongMenuSlotId,
} from "@/contracts/songMenu";
import { songArtworkSource } from "@/domain/artwork";
import { formatArtists } from "@/domain/format";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";

export interface SongMenuProps {
  visible: boolean;
  onClose: () => void;
  context: SongMenuContext;
  /**
   * Pointer coordinates to anchor a POPOVER at (plano-uma-so-app 4.3,
   * "Menus" row): at desktop widths a right-click or a hover-revealed `...`
   * passes them and the menu opens as an anchored card; without an anchor
   * (or on touch/mobile) the bottom sheet stays. The CONTENT is the same
   * component tree either way, so the frozen slot order can never fork.
   */
  anchor?: PopoverAnchor | null;
}

const MenuItemRow = ({
  item,
  onSelect,
}: {
  item: SongMenuItem;
  onSelect: (item: SongMenuItem) => void;
}) => {
  const { tokens, ink } = useTheme();
  const t = useT();
  const icon = iconForHint(item.icon);
  const tint = item.destructive ? ink.destructive : tokens.foreground;
  return (
    <Pressable
      onPress={() => onSelect(item)}
      disabled={item.disabled}
      accessibilityRole="menuitem"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 20,
        paddingVertical: 13,
        opacity: item.disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      {icon ? <Icon name={icon} size={19} color={tint} /> : <View style={{ width: 19 }} />}
      <Text style={{ color: tint, fontSize: 15 }} numberOfLines={1}>
        {t(item.labelKey, item.labelParams)}
      </Text>
    </Pressable>
  );
};

/**
 * One registered slot. The hook identity is captured on mount so the call
 * stays unconditional for this component instance (registrations happen at
 * boot, before any menu opens).
 */
const RegisteredSlot = ({
  hook,
  ctx,
  onSelect,
}: {
  hook: SongMenuSlotHook;
  ctx: SongMenuContext;
  onSelect: (item: SongMenuItem) => void;
}) => {
  const items = hook(ctx);
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item) => (
        <MenuItemRow key={item.id} item={item} onSelect={onSelect} />
      ))}
    </>
  );
};

const SlotItems = ({
  id,
  ctx,
  onSelect,
  onOpenCredits,
  onOpenMatch,
}: {
  id: SongMenuSlotId;
  ctx: SongMenuContext;
  onSelect: (item: SongMenuItem) => void;
  onOpenCredits: () => void;
  onOpenMatch: () => void;
}) => {
  // Capture once per mount: the menu mounts on open, so a fresh open sees
  // fresh registrations while this instance keeps its hook call stable.
  const [hook] = useState<SongMenuSlotHook | null>(() => getSongMenuSlot(id) ?? null);

  const registered = hook ? (
    <RegisteredSlot hook={hook} ctx={ctx} onSelect={onSelect} />
  ) : null;

  if (id === "surfaceExtras") {
    const extras = ctx.surfaceExtras ?? [];
    return (
      <>
        {registered}
        {extras.map((item) => (
          <MenuItemRow key={item.id} item={item} onSelect={onSelect} />
        ))}
      </>
    );
  }

  if (id === "viewCredits" && !hook) {
    // Renderer-owned fallback: FR-125 ships with the renderer. Condition
    // frozen by the contract: only when song.artists is non-empty. The
    // credits item switches the menu session to the dialog stage instead
    // of closing it, so the internally hosted dialog stays mounted.
    if ((ctx.song.artists ?? []).length === 0) return null;
    return (
      <MenuItemRow
        item={{
          id: "viewCredits",
          labelKey: "components.music.SongCard.viewCredits",
          icon: "users",
          onPress: onOpenCredits,
        }}
        onSelect={(item) => item.onPress()}
      />
    );
  }

  if (id === "fixMatch" && !hook) {
    // Renderer-owned, like viewCredits. Só faz sentido numa faixa que foi
    // EMPARELHADA: um ficheiro carregado à mão não tem fonte para trocar, e
    // uma faixa de jam não é nossa.
    if (ctx.song.jam_song) return null;
    if (ctx.song.source_kind === "upload") return null;
    return (
      <MenuItemRow
        item={{
          id: "fixMatch",
          labelKey: "components.music.SongMatchDialog.menuItem",
          icon: "alert-circle",
          onPress: onOpenMatch,
        }}
        onSelect={(item) => item.onPress()}
      />
    );
  }

  return registered;
};

export const SongMenu = ({ visible, onClose, context, anchor }: SongMenuProps) => {
  const { tokens } = useTheme();
  const desktopShell = useDesktopShell();
  const [stage, setStage] = useState<"menu" | "credits" | "match">("menu");
  const { song } = context;
  // Uma intervencao do DJ nao e uma musica da biblioteca: nao se gosta, nao
  // se descarrega, nao entra numa playlist e nao tem creditos. Uma guarda
  // aqui vale mais do que a mesma linha repetida por cada registo de item.
  const djClip = isDjClip(song);

  const closeAll = () => {
    setStage("menu");
    onClose();
  };

  const handleSelect = (item: SongMenuItem) => {
    closeAll();
    item.onPress();
  };

  if (djClip) return null;

  // ONE content tree for both containers - the frozen slot order, the
  // header, the credits hand-off are byte-identical whether the frame is a
  // sheet (touch) or an anchored popover (desktop pointer).
  const content = (
    <>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 20,
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: tokens.border,
          marginBottom: 4,
        }}
      >
        <ArtworkImage
          source={songArtworkSource(song)}
          songId={song.id}
          size={44}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600" }}
            numberOfLines={1}
          >
            {song.title}
          </Text>
          <Text style={{ color: tokens.mutedForeground, fontSize: 12 }} numberOfLines={1}>
            {formatArtists(song)}
          </Text>
        </View>
      </View>
      {SONG_MENU_SLOT_ORDER.map((id) => (
        <SlotItems
          key={id}
          id={id}
          ctx={context}
          onSelect={handleSelect}
          onOpenCredits={() => setStage("credits")}
          onOpenMatch={() => setStage("match")}
        />
      ))}
    </>
  );

  return (
    <>
      {desktopShell && anchor ? (
        <Popover visible={visible && stage === "menu"} anchor={anchor} onClose={closeAll}>
          {content}
        </Popover>
      ) : (
        <BottomSheet visible={visible && stage === "menu"} onClose={closeAll}>
          {content}
        </BottomSheet>
      )}
      <SongCreditsDialog
        visible={visible && stage === "credits"}
        song={song}
        onClose={closeAll}
      />
      <SongMatchDialog visible={visible && stage === "match"} song={song} onClose={closeAll} />
    </>
  );
};
