/**
 * O Rewind toca a música de cada cartão. Só neste aparelho e só quando isso
 * não rouba nada: se outro aparelho da conta é o que toca (este é o comando
 * dele), as histórias ficam caladas. Antes, abrir o Rewind no telemóvel
 * tirava o som do computador.
 */
import type { RemoteRole } from "@/remote/store";

export const mayPlaySoundtrack = (role: RemoteRole): boolean => role !== "controller";
