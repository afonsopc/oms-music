/** Os textos da Montagem (os de ir buscar vídeos ficam em clipSource.web.ts). */
import type { Locale } from "@/i18n";
import type { MontageStyle } from "../../../montage/protocol";

interface Copy {
  title: string;
  close: string;
  none: string;
  noSong: string;
  has: (n: number) => string;
  themes: string;
  themesOrLinks: string;
  style: string;
  styles: Record<MontageStyle, string>;
  make: string;
  another: string;
  library: string;
  cutting: string;
  ready: (n: number) => string;
  nothingNew: string;
  failed: string;
  emptyLibrary: string;
  emptyFetch: string;
  turnOff: string;
  turnOn: string;
}

export const COPY: Record<Locale, Copy> = {
  pt: {
    title: "Montagem",
    close: "Fechar",
    none: "Esta música ainda não tem montagem. Escreve temas e carrega em Fazer.",
    noSong: "Põe uma música a tocar.",
    has: (n) => `Montagem guardada, ${n} clipes. Toca sempre que ouvires esta música.`,
    themes: "Temas",
    themesOrLinks: "Temas ou links",
    style: "Estilo",
    styles: { fast: "Cortes rápidos", slow: "Lento e emotivo", chaos: "Caos" },
    make: "Fazer",
    another: "Outra versão",
    library: "A ver a tua biblioteca…",
    cutting: "A cortar ao ritmo…",
    ready: (n) => `Pronto, ${n} clipes`,
    nothingNew: "Já tinhas os clipes",
    failed: "Não deu. Tenta outra vez daqui a pouco.",
    emptyLibrary: "Ainda não tens clipes. Faz a primeira montagem no computador ou na web.",
    emptyFetch: "Ainda não tens clipes. Escreve um tema.",
    turnOff: "Desligar a montagem",
    turnOn: "Ligar a montagem",
  },
  en: {
    title: "Montage",
    close: "Close",
    none: "This song has no montage yet. Type themes and press Make.",
    noSong: "Play a song.",
    has: (n) => `Saved montage, ${n} clips. Plays whenever you hear this song.`,
    themes: "Themes",
    themesOrLinks: "Themes or links",
    style: "Style",
    styles: { fast: "Fast cuts", slow: "Slow and emotional", chaos: "Chaos" },
    make: "Make",
    another: "Another version",
    library: "Checking your library…",
    cutting: "Cutting to the beat…",
    ready: (n) => `Done, ${n} clips`,
    nothingNew: "You already had the clips",
    failed: "That didn't work. Try again in a bit.",
    emptyLibrary: "No clips yet. Make your first montage on the computer or the web.",
    emptyFetch: "No clips yet. Type a theme.",
    turnOff: "Turn the montage off",
    turnOn: "Turn the montage on",
  },
  lv: {
    title: "Montāža",
    close: "Aizvērt",
    none: "Šai dziesmai vēl nav montāžas. Ieraksti tēmas un spied Taisīt.",
    noSong: "Atskaņo dziesmu.",
    has: (n) => `Saglabāta montāža, ${n} klipi. Skan katru reizi ar šo dziesmu.`,
    themes: "Tēmas",
    themesOrLinks: "Tēmas vai saites",
    style: "Stils",
    styles: { fast: "Ātri griezieni", slow: "Lēni un emocionāli", chaos: "Haoss" },
    make: "Taisīt",
    another: "Cita versija",
    library: "Skatos tavu bibliotēku…",
    cutting: "Griežu pēc ritma…",
    ready: (n) => `Gatavs, ${n} klipi`,
    nothingNew: "Klipi tev jau bija",
    failed: "Neizdevās. Mēģini vēlreiz pēc brīža.",
    emptyLibrary: "Vēl nav klipu. Pirmo montāžu taisi datorā vai tīmeklī.",
    emptyFetch: "Vēl nav klipu. Ieraksti tēmu.",
    turnOff: "Izslēgt montāžu",
    turnOn: "Ieslēgt montāžu",
  },
};
