/** "O Melhor Assistente" (3.8): o modelo propõe, o servidor valida - o
 *  contrato vive em docs/propostas/2026-08-17-assistente.md. Enquanto o
 *  backend não aplicar o diff, isto responde 404 e o ecrã mostra o erro
 *  com honestidade. */
import { request } from "../client";

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantAnswer {
  reply: string;
  playlist?: { id: number; name: string; song_count: number } | null;
}

export const askAssistant = (
  messages: readonly AssistantMessage[],
): Promise<AssistantAnswer> =>
  request("POST", "/music_assistant", { body: { messages }, timeoutMs: 90_000 });
