// O número de build do iOS (CFBundleVersion), o que o scripts/ios-testflight.sh
// gera e o app.config.js verifica.
//
// O SDK do Google Cast lê o CFBundleVersion como "major.minor.patch" com
// largura 6 (+[PHTPhenotypeUtil appVersionAsIntegerWithStandardWidth]) e faz
// NSAssert se alguma parte passa de 999999 (PHTPhenotypeUtil.m:91). Com o
// antigo AAAAMMDDHHMM (202611050730, um só número) a app abortava assim que o
// Cast via uma TV na rede, e como o SDK guarda os aparelhos e procura no
// arranque, abortava em todos os arranques (2.1.0 e 2.1.1, 2026-11-05).
//
// Formato: AAMMDD.HHMM sem zeros à esquerda (261105.812 = 5/11/2026 08:12).
// A Apple aceita até três inteiros separados por pontos, compara-os um a um
// e só exige que o build seja novo dentro de cada versão (2.1.2, 2.1.3...).
const MAX_PART = 999999;

/** Build de agora (hora local), ex. "261105.812". */
function iosBuildNumber(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const day = `${p(date.getFullYear() % 100)}${p(date.getMonth() + 1)}${p(date.getDate())}`;
  return `${Number(day)}.${date.getHours() * 100 + date.getMinutes()}`;
}

/** null se serve; senão, o porquê. */
function iosBuildNumberProblem(build) {
  const s = String(build ?? "");
  if (!/^\d+(\.\d+){0,2}$/.test(s)) return `"${s}" não é 1 a 3 inteiros separados por pontos`;
  const big = s.split(".").find((part) => Number(part) > MAX_PART);
  if (big) return `"${s}": a parte ${big} passa de ${MAX_PART} e o Google Cast aborta a app (PHTPhenotypeUtil)`;
  return null;
}

module.exports = { iosBuildNumber, iosBuildNumberProblem, MAX_PART };

// bun scripts/ios-build-number.js            escreve o build de agora
// bun scripts/ios-build-number.js check <b>  sai 1 se <b> não serve
if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "check") {
    const problem = iosBuildNumberProblem(arg);
    if (problem) {
      console.error(`build iOS inválido: ${problem}`);
      process.exit(1);
    }
  } else {
    console.log(iosBuildNumber());
  }
}
