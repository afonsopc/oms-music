/**
 * Hand-rolled ICU-lite interpolation (DESIGN.md 12). The port audit found the
 * catalogs use exactly:
 *   - {param} substitution,
 *   - {name, plural, ...} with selectors `zero`, `one`, `other` and exact
 *     matches `=N`, `#` inside branches, and nested {param} substitution,
 *   - {name, number} formatting.
 * Nothing else (no select, no date/time). Nothing speculative is added; if a
 * future catalog needs more, escalate for `use-intl` instead of growing this.
 *
 * Apostrophe handling follows ICU: '' is a literal apostrophe; a single
 * apostrophe before a special char quotes the following text; any other
 * apostrophe is literal.
 */

export type IcuParams = Record<string, string | number>;

/** CLDR cardinal plural category for our three locales (pure, testable). */
export const pluralCategory = (locale: string, n: number): "zero" | "one" | "other" => {
  const abs = Math.abs(n);
  if (locale === "lv") {
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod10 === 0 || (mod100 >= 11 && mod100 <= 19)) return "zero";
    if (mod10 === 1 && mod100 !== 11) return "one";
    return "other";
  }
  // en and pt-PT: one for exactly 1.
  return abs === 1 ? "one" : "other";
};

const formatNumber = (locale: string, value: number): string => {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
};

/** Splits "sel1 {...} sel2 {...}" into branch map, brace-aware. */
const parsePluralBranches = (source: string): Map<string, string> => {
  const branches = new Map<string, string>();
  let i = 0;
  const len = source.length;
  while (i < len) {
    while (i < len && /\s/.test(source[i])) i++;
    let selector = "";
    while (i < len && source[i] !== "{" && !/\s/.test(source[i])) {
      selector += source[i];
      i++;
    }
    while (i < len && /\s/.test(source[i])) i++;
    if (i >= len || source[i] !== "{") break;
    let depth = 0;
    let body = "";
    do {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
      if (depth > 0 && !(depth === 1 && source[i] === "{")) body += source[i];
      i++;
    } while (i < len && depth > 0);
    if (selector) branches.set(selector, body);
  }
  return branches;
};

/** Finds the argument at `start` ("{"), returns its full body and end index. */
const readArgument = (message: string, start: number): { body: string; end: number } | null => {
  let depth = 0;
  let body = "";
  for (let i = start; i < message.length; i++) {
    const ch = message[i];
    if (ch === "{") {
      depth++;
      if (depth === 1) continue;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return { body, end: i };
    }
    body += ch;
  }
  return null;
};

const formatArgument = (body: string, locale: string, params: IcuParams): string => {
  const firstComma = body.indexOf(",");
  if (firstComma === -1) {
    const name = body.trim();
    const value = params[name];
    return value === undefined ? `{${name}}` : String(value);
  }
  const name = body.slice(0, firstComma).trim();
  const rest = body.slice(firstComma + 1).trim();
  const value = params[name];

  if (rest === "number") {
    return typeof value === "number" ? formatNumber(locale, value) : String(value ?? "");
  }

  if (rest.startsWith("plural,")) {
    const branchesSource = rest.slice("plural,".length);
    const branches = parsePluralBranches(branchesSource);
    const n = typeof value === "number" ? value : Number(value ?? NaN);
    let branch = branches.get(`=${n}`);
    if (branch === undefined) branch = branches.get(pluralCategory(locale, n));
    if (branch === undefined) branch = branches.get("other") ?? "";
    const withHash = branch.replace(/#/g, formatNumber(locale, n));
    return formatIcu(withHash, locale, params);
  }

  // Unknown form: fall back to the raw value.
  return value === undefined ? `{${body}}` : String(value);
};

/** Formats an ICU-lite message with the given params. */
export const formatIcu = (message: string, locale: string, params: IcuParams = {}): string => {
  let out = "";
  let i = 0;
  const len = message.length;
  while (i < len) {
    const ch = message[i];
    if (ch === "'") {
      const next = message[i + 1];
      if (next === "'") {
        out += "'";
        i += 2;
        continue;
      }
      if (next === "{" || next === "}" || next === "#") {
        // Quoted literal run until the closing apostrophe.
        let j = i + 1;
        let literal = "";
        while (j < len) {
          if (message[j] === "'" && message[j + 1] === "'") {
            literal += "'";
            j += 2;
            continue;
          }
          if (message[j] === "'") break;
          literal += message[j];
          j++;
        }
        out += literal;
        i = j < len ? j + 1 : j;
        continue;
      }
      out += "'";
      i++;
      continue;
    }
    if (ch === "{") {
      const arg = readArgument(message, i);
      if (!arg) {
        out += message.slice(i);
        break;
      }
      out += formatArgument(arg.body, locale, params);
      i = arg.end + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
};
