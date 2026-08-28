/**
 * The game separates item-text sections with a line of exactly eight hyphens.
 * Nothing else in the text produces that line, so this is the whole grammar
 * at the top level.
 */
const SEPARATOR = '--------';

export function splitSections(text: string): string[][] {
  const sections: string[][] = [];
  let current: string[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    if (line.trim() === SEPARATOR) {
      if (current.length) sections.push(current);
      current = [];
      continue;
    }
    if (line.trim() !== '') current.push(line);
  }
  if (current.length) sections.push(current);
  return sections;
}

/** `Item Level: 79` -> `['Item Level', '79']`, or null for a non-keyed line. */
export function keyValue(line: string): [string, string] | null {
  const at = line.indexOf(': ');
  if (at <= 0) return null;
  const key = line.slice(0, at).trim();
  // Mod text can contain a colon; a property key never has spaces before one
  // followed by a digit-or-word value and is always short.
  if (key.length > 40) return null;
  return [key, line.slice(at + 2).trim()];
}
