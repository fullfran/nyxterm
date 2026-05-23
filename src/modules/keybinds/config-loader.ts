/**
 * config-loader.ts — Ghostty-style keybind config parser.
 *
 * parseConfigText(text) → { entries: ConfigEntry[]; warnings: ConfigWarning[] }
 *
 * Grammar (spec §4 ABNF):
 *   keybind-line = "keybind" *WSP "=" *WSP chord *WSP "=" *WSP target *WSP
 *   chord        = modifier *("+" modifier) "+" key
 *   target       = action-ref / "unbind"
 *
 * Behavior:
 *  - Line-based; one binding per line
 *  - Comments start with "#" (after optional leading whitespace)
 *  - Blank lines ignored
 *  - Whitespace tolerant around "="
 *  - Chord tokens lowercased before lookup
 *  - normalizeChord(parts) called for canonical Chord brand
 *  - Invalid lines → ConfigWarning (line number + reason); valid lines still returned
 *  - "unbind" target is a special directive (not validated as ActionId)
 *
 * NOTE: ActionId validity is NOT checked here. That is the resolver's job (T3.2,
 * design §4.6: two-layer validation — parse vs register). RESERVED_CHORDS
 * rejection happens in PR4 (validation slice).
 *
 * REQ-KB-010, REQ-KB-012, REQ-KB-013, spec §4.
 */

import type { Chord } from "./types";
import { normalizeChord } from "./normalize";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Raw parsed entry from the config file.
 *
 * `target` is a plain string here because the parser does not validate whether
 * it is a known ActionId. The resolver (resolver.ts) does that check.
 *
 * REQ-KB-013: carries chord, target, source line number, and source tag.
 */
export interface ConfigEntry {
  /** Normalized Chord brand — canonical form ready for binding map lookup */
  readonly chord: Chord;
  /** Raw target string: either a known ActionId string or "unbind" */
  readonly target: string;
  /** 1-based line number in the config file (for diagnostics) */
  readonly lineNumber: number;
  /** Always "user" — differentiates from "default" factory entries */
  readonly source: "user";
}

/**
 * Diagnostic warning emitted when a line fails to parse.
 *
 * The parser does NOT throw; it emits warnings and skips the bad line.
 * REQ-KB-012, REQ-KB-034 (do not abort on first error).
 */
export interface ConfigWarning {
  /** 1-based line number of the offending line */
  readonly lineNumber: number;
  /** Raw line content (useful for user-facing diagnostics) */
  readonly line: string;
  /** Human-readable reason why the line was rejected */
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Known modifiers (spec §4)
// ---------------------------------------------------------------------------

const VALID_MODIFIERS = new Set<string>(["ctrl", "shift", "alt", "super"]);

// ---------------------------------------------------------------------------
// Known key tokens — aliases and specials (spec §4)
// ---------------------------------------------------------------------------

const SPECIAL_KEYS = new Set<string>([
  "escape", "return", "enter", "tab", "space", "backspace",
  "delete", "insert", "home", "end", "pageup", "pagedown",
  "up", "down", "left", "right",
  "f1", "f2", "f3", "f4", "f5", "f6",
  "f7", "f8", "f9", "f10", "f11", "f12",
]);

const SYMBOL_ALIASES = new Set<string>([
  "plus", "minus", "comma", "period", "slash", "backslash",
]);

// Single letter (a-z), single digit (0-9), or known special/symbol
function isValidKey(token: string): boolean {
  if (token.length === 1) {
    const code = token.charCodeAt(0);
    // a-z (0x61-0x7a)
    if (code >= 0x61 && code <= 0x7a) return true;
    // 0-9 (0x30-0x39)
    if (code >= 0x30 && code <= 0x39) return true;
  }
  return SPECIAL_KEYS.has(token) || SYMBOL_ALIASES.has(token);
}

// ---------------------------------------------------------------------------
// parseChordString — helper to turn "ctrl+shift+c" into Chord brand
// ---------------------------------------------------------------------------

/**
 * Parse a raw chord string from the config file into a canonical Chord brand.
 *
 * Returns null if the chord is malformed (unknown modifier, invalid key,
 * no key token, duplicate modifiers, etc.).
 *
 * Design §4.1 (implementation note): the chord string is split on "+",
 * all modifiers come first, then the key. The last token is the key.
 */
export function parseChordString(raw: string): Chord | null {
  const lowered = raw.toLowerCase().trim();

  if (!lowered) return null;

  // Split on "+" — but we must handle "plus" as a token (it contains no "+")
  // The config format uses raw "+" as the separator between tokens, so
  // "ctrl+plus" splits cleanly into ["ctrl", "plus"].
  const tokens = lowered.split("+");

  if (tokens.length === 0) return null;

  // The last token is the key; all preceding tokens are modifiers (or empty due to trailing +)
  const keyToken = tokens[tokens.length - 1];
  const modifierTokens = tokens.slice(0, tokens.length - 1);

  // Validate key
  if (!isValidKey(keyToken)) return null;

  // Validate all modifier tokens
  for (const mod of modifierTokens) {
    if (!VALID_MODIFIERS.has(mod)) return null;
  }

  // Build canonical chord via normalizeChord
  return normalizeChord([...modifierTokens, keyToken]);
}

// ---------------------------------------------------------------------------
// parseConfigText
// ---------------------------------------------------------------------------

/**
 * Parse raw config file text into a list of ConfigEntry records and warnings.
 *
 * Pure function — no I/O, no side effects.
 *
 * @param text - Raw content of the config file (UTF-8 string)
 * @returns { entries, warnings }
 *
 * REQ-KB-012, REQ-KB-013, REQ-KB-034, spec §4.
 */
export function parseConfigText(
  text: string,
): { entries: ConfigEntry[]; warnings: ConfigWarning[] } {
  const entries: ConfigEntry[] = [];
  const warnings: ConfigWarning[] = [];

  // Normalize line endings (CRLF → LF)
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1; // 1-based
    const raw = lines[i];
    const trimmed = raw.trim();

    // Blank line
    if (trimmed === "") continue;

    // Comment line (starts with "#" after optional whitespace)
    if (trimmed.startsWith("#")) continue;

    // Must start with "keybind" keyword (case-insensitive for the keyword only;
    // the rest is normalized per spec)
    if (!trimmed.toLowerCase().startsWith("keybind")) {
      warnings.push({
        lineNumber,
        line: raw,
        reason: 'missing "keybind" keyword',
      });
      continue;
    }

    // Strip the "keybind" prefix and look for "= chord = target"
    const afterKeyword = trimmed.slice("keybind".length).trim();

    // Must start with "="
    if (!afterKeyword.startsWith("=")) {
      warnings.push({
        lineNumber,
        line: raw,
        reason: 'expected "=" after "keybind"',
      });
      continue;
    }

    // Content after first "="
    const afterFirstEq = afterKeyword.slice(1).trim();

    // Find the second "=" — split on first occurrence only
    const secondEqIdx = afterFirstEq.indexOf("=");
    if (secondEqIdx === -1) {
      warnings.push({
        lineNumber,
        line: raw,
        reason: 'missing second "=" (expected: keybind = chord = target)',
      });
      continue;
    }

    const rawChord = afterFirstEq.slice(0, secondEqIdx).trim();
    const rawTarget = afterFirstEq.slice(secondEqIdx + 1).trim();

    // Validate chord string
    if (!rawChord) {
      warnings.push({
        lineNumber,
        line: raw,
        reason: "empty chord",
      });
      continue;
    }

    // Validate target string
    if (!rawTarget) {
      warnings.push({
        lineNumber,
        line: raw,
        reason: "empty target",
      });
      continue;
    }

    // Parse chord
    const chord = parseChordString(rawChord);
    if (chord === null) {
      warnings.push({
        lineNumber,
        line: raw,
        reason: `invalid chord "${rawChord}" — unknown modifier or key token`,
      });
      continue;
    }

    // Validate target: either "unbind" or looks like a valid action-ref
    // (domain.identifier or bare identifier). We do NOT check against ActionId
    // union here — that is the resolver's job.
    const normalizedTarget = rawTarget; // case-sensitive per spec (action_ids are lowercase by convention)
    if (normalizedTarget !== "unbind" && !isValidActionRef(normalizedTarget)) {
      warnings.push({
        lineNumber,
        line: raw,
        reason: `invalid target "${normalizedTarget}" — expected action-ref (e.g. "terminal.copy_to_clipboard") or "unbind"`,
      });
      continue;
    }

    entries.push({
      chord,
      target: normalizedTarget,
      lineNumber,
      source: "user",
    });
  }

  return { entries, warnings };
}

// ---------------------------------------------------------------------------
// isValidActionRef — shallow grammar check for action-ref
// ---------------------------------------------------------------------------

/**
 * Returns true if the string looks like a valid action-ref per spec §4 grammar.
 *
 * action-ref = [domain "."] identifier
 * domain     = 1*(letter / digit)
 * identifier = 1*(letter / digit / "_")
 *
 * This is a GRAMMAR check only — it does not validate against the ActionId union.
 * Unknown action_ids are reported by the resolver as ResolverWarning, not here.
 */
function isValidActionRef(s: string): boolean {
  // Allow: word chars + dot + underscore, no leading/trailing dot, no double dot
  // Matches: "terminal.copy_to_clipboard", "pane.split_right", "foo", "foo_bar"
  return /^[a-z0-9][a-z0-9_]*(\.[a-z0-9][a-z0-9_]*)*$/.test(s);
}
