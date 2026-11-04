// `bun test` (bunfig.toml): gerar o índice das cenas antes de os testes o importarem.
import { generate } from "./registry";
await generate({ quiet: true });
