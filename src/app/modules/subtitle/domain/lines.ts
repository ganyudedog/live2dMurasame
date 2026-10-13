/** Wrap graphemes using the current font metrics; only the last two lines are rendered. */
export function lastTwoLines(text: string, maxWidth: number, measure: (text: string) => number): [string, string] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let previous = ''; let line = '';
  for (const { segment } of segmenter.segment(text.replace(/\r/g, ''))) {
    if (segment === '\n') { previous = line; line = ''; continue; }
    if (line && measure(line + segment) > maxWidth) { previous = line; line = segment; }
    else line += segment;
  }
  return [previous, line];
}
