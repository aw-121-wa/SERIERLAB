/**
 * Extract a simple fixed-address C expression under the cursor.
 * Grammar (v1): IDENT ( . IDENT | [ DIGITS ] )*
 * Rejects pointers, calls, variable indices — never guess.
 */

export type SourceExpression = {
  text: string;
  startOffset: number;
  endOffset: number;
};

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

function isIdentStart(ch: string): boolean {
  return IDENT_START.test(ch);
}

function isIdentPart(ch: string): boolean {
  return IDENT_PART.test(ch);
}

function skipStringOrComment(source: string, i: number): number {
  // Returns index after a line comment or string/char if source[i] starts one; else -1.
  const ch = source[i];
  if (ch === '/' && source[i + 1] === '/') {
    let j = i + 2;
    while (j < source.length && source[j] !== '\n') j++;
    return j;
  }
  if (ch === '/' && source[i + 1] === '*') {
    let j = i + 2;
    while (j < source.length - 1 && !(source[j] === '*' && source[j + 1] === '/')) j++;
    return Math.min(j + 2, source.length);
  }
  if (ch === '"' || ch === "'") {
    const quote = ch;
    let j = i + 1;
    while (j < source.length) {
      if (source[j] === '\\') {
        j += 2;
        continue;
      }
      if (source[j] === quote) return j + 1;
      j++;
    }
    return source.length;
  }
  return -1;
}

function inSkippedRegion(source: string, offset: number): boolean {
  let i = 0;
  while (i < offset && i < source.length) {
    const skip = skipStringOrComment(source, i);
    if (skip > i) {
      if (offset < skip) return true;
      i = skip;
      continue;
    }
    i++;
  }
  return false;
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/** Try to parse `[digitsOrIdent]` ending at `end` (end points past ']'). Returns start index or -1. */
function matchIndexBefore(source: string, end: number): number {
  if (end < 2 || source[end - 1] !== ']') return -1;
  let k = end - 2;
  let chars = 0;
  while (k >= 0 && (isDigit(source[k]!) || isIdentPart(source[k]!))) {
    k--;
    chars++;
  }
  if (chars === 0 || source[k] !== '[') return -1;
  return k;
}

/**
 * Parse a qualified expression containing `offset`.
 * Cursor anywhere inside `controller.yaw.kp` or `motors[2].speed` returns the full span.
 */
export function expressionAtOffset(source: string, offset: number): SourceExpression | undefined {
  if (!source || offset < 0 || offset > source.length) return undefined;
  if (inSkippedRegion(source, offset)) return undefined;

  // Snap cursor onto a token if it sits just after the last char.
  let pos = offset;
  if (pos > 0 && pos <= source.length) {
    const at = pos < source.length ? source[pos]! : '';
    const prev = source[pos - 1]!;
    if (!isIdentPart(at) && at !== '[' && at !== '.' && (isIdentPart(prev) || prev === ']')) {
      pos = pos - 1;
    }
  }
  if (pos < source.length && !isIdentPart(source[pos]!) && source[pos] !== '[' && source[pos] !== ']') {
    // Allow pos on '[' of an index that belongs to previous ident — handled below via walk-left.
    if (source[pos] !== '[') return undefined;
  }

  // Walk left from pos to expression start.
  let start = pos;
  for (;;) {
    if (start <= 0) break;
    const ch = source[start - 1]!;
    if (isIdentPart(ch)) {
      start--;
      continue;
    }
    if (ch === ']') {
      const idx = matchIndexBefore(source, start);
      if (idx >= 0) {
        start = idx;
        continue;
      }
      break;
    }
    if (ch === '[') {
      // Include '[' so walk continues into the base identifier.
      start--;
      continue;
    }
    if (ch === '.') {
      // continue through `ident.` or `].` (member after array index)
      if (start >= 2 && (isIdentPart(source[start - 2]!) || source[start - 2] === ']')) {
        start--;
        continue;
      }
      break;
    }
    break;
  }

  // Advance pos to a position at/after an identifier char for right-expand.
  let i = start;
  if (!isIdentStart(source[i]!)) return undefined;
  i++;
  while (i < source.length && isIdentPart(source[i]!)) i++;
  for (;;) {
    if (source[i] === '.') {
      if (!(i + 1 < source.length && isIdentStart(source[i + 1]!))) break;
      i++;
      while (i < source.length && isIdentPart(source[i]!)) i++;
      continue;
    }
    if (source[i] === '[') {
      let j = i + 1;
      // Allow [digits] or [ident] so we capture the full span; resolve later rejects non-literal.
      let chars = 0;
      while (j < source.length && (isDigit(source[j]!) || isIdentPart(source[j]!))) {
        j++;
        chars++;
      }
      if (chars === 0 || source[j] !== ']') break;
      i = j + 1;
      continue;
    }
    break;
  }

  const text = source.slice(start, i);
  if (!text) return undefined;
  // foo( is a call — not a runtime variable.
  if (source[i] === '(') return undefined;
  // ptr->member: do not pretend `ptr` or the member token is a standalone runtime expr
  // when the cursor is on `->`.
  if (source[i] === '-' && source[i + 1] === '>') return undefined;
  const before = start > 0 ? source[start - 1]! : '';
  if (isIdentPart(before) || before === '>' || before === '*' || before === ']') return undefined;
  return { text, startOffset: start, endOffset: i };
}

/** Split expression into root + path segments for resolution. */
export function splitExpression(text: string): { root: string; path: string[] } | undefined {
  // e.g. controller.yaw.kp / motors[2].speed
  const m = text.match(/^([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z_][A-Za-z0-9_]*|\[[0-9]+\])*)$/);
  if (!m) return undefined;
  const root = m[1]!;
  const rest = m[2] ?? '';
  const path: string[] = [];
  const re = /\.([A-Za-z_][A-Za-z0-9_]*)|\[([0-9]+)\]/g;
  let g: RegExpExecArray | null;
  while ((g = re.exec(rest))) {
    if (g[1] !== undefined) path.push(g[1]);
    else path.push(`[${g[2]}]`);
  }
  return { root, path };
}
