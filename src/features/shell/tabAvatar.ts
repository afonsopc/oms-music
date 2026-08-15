/**
 * O avatar da tab "Perfil", em tamanho de icone.
 *
 * A UITabBar NAO redimensiona a imagem que lhe damos: desenha-a ao tamanho
 * natural. Como o /users/:id/picture serve a fotografia inteira (ate 1024px),
 * assim que ela aterrava a barra ficava com uma cara gigante esticada de
 * ponta a ponta, por cima dos outros tres separadores (screenshot do dono,
 * 2026-08-15). O simbolo do sistema mostrado ANTES do load e que dava a
 * ilusao de estar tudo bem.
 *
 * Aqui a foto e reduzida a EDGE px e guardada em ficheiro; so entao vai para
 * a barra. Enquanto nao estiver pronta - e se falhar - fica o simbolo, que e
 * o estado correcto e nao um remendo.
 *
 * O endpoint e publico (allow_unauthenticated_access :picture no backend),
 * por isso o descarregador do ImageManipulator chega la sem credenciais.
 */
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { avatarUrl } from "@/api/mediaUrl";
import type { UserId } from "@/domain/ids";

/** 3x de um icone de 28pt: nitido no Pro Max, leve na memoria. */
const EDGE = 84;

/** Um utilizador, um ficheiro - a barra remonta a cada troca de tab. */
const cache = new Map<string, string>();

export const useTabAvatarIcon = (userId: UserId | null): string | null => {
  const key = userId == null ? "" : String(userId);
  const [uri, setUri] = useState<string | null>(() => cache.get(key) ?? null);

  // Ajuste durante o render, nao no effect: o ficheiro pode ter sido gerado
  // por outra montagem da barra, e um setState sincrono dentro de um effect
  // e exactamente o que o React Compiler recusa neste repo.
  const cached = cache.get(key) ?? null;
  if (cached !== null && cached !== uri) setUri(cached);

  useEffect(() => {
    if (!key || Platform.OS === "web" || cache.has(key)) return;
    let alive = true;
    void (async () => {
      try {
        const ref = await ImageManipulator.manipulate(avatarUrl(userId as UserId))
          .resize({ width: EDGE, height: EDGE })
          .renderAsync();
        const saved = await ref.saveAsync({ format: SaveFormat.PNG });
        if (!alive) return;
        cache.set(key, saved.uri);
        setUri(saved.uri);
      } catch {
        // Sem foto, foto ilegivel ou rede em baixo: o simbolo fica.
      }
    })();
    return () => {
      alive = false;
    };
  }, [key, userId]);

  return key ? uri : null;
};
