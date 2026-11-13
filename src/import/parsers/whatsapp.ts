import type { ParsedMessage } from '../../types';
import { to24h, toLines } from './normalize';

// [optional "["] date [,] [오전|오후] h:mm[:ss] [AM|PM] ("] " | " - ") rest
const HEADER =
  /^‎?\[?(\d{1,4})([./-])(\s?)(\d{1,2})\2\s?(\d{1,4})\.?,?\s+(?:(오전|오후)\s)?(\d{1,2}):(\d{2})(?::\d{2})?(?:[\s ]?([AaPp])\.?[Mm]\.?)?(?:\]\s| - )(.*)$/;

const MEDIA = /^<[^>]*(omitted|생략|제외)[^>]*>$/i;

interface Raw {
  a: number;
  b: number;
  c: number;
  yearFirst: boolean;
  hour: number;
  minute: number;
  rest: string;
}

function readHeader(line: string): Raw | null {
  const m = HEADER.exec(line);
  if (!m) return null;
  const [, a, sep, space, b, c, korAmPm, h, mi, enAmPm, rest] = m;
  const ampm = korAmPm ?? (enAmPm ? (enAmPm.toLowerCase() === 'p' ? 'PM' : 'AM') : undefined);
  return {
    a: +a,
    b: +b,
    c: +c,
    yearFirst: a.length === 4 || (sep === '.' && space === ' '),
    hour: to24h(ampm, +h),
    minute: +mi,
    rest,
  };
}

const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/** Parses a WhatsApp export (Android or iOS, several locales). Returns null when the text is not one. */
export function parseWhatsApp(text: string): ParsedMessage[] | null {
  const lines = toLines(text);
  const headers = lines.map(readHeader);
  const found = headers.filter((h): h is Raw => h !== null);
  if (found.length === 0) return null;

  // A single line cannot tell 3/4 (March 4) from 3/4 (3 April); the whole file can.
  const monthFirst = !found.some((h) => !h.yearFirst && h.a > 12) && found.some((h) => !h.yearFirst && h.b > 12);

  const out: ParsedMessage[] = [];
  let current: ParsedMessage | null = null;

  lines.forEach((line, i) => {
    const h = headers[i];
    if (!h) {
      if (current) current.text += '\n' + line;
      return;
    }
    current = null;
    const split = h.rest.indexOf(': ');
    if (split < 0) return; // system notice
    const sender = h.rest.slice(0, split);
    const body = h.rest.slice(split + 2);
    if (body.startsWith('‎') || MEDIA.test(body.trim())) return;

    let year: number, month: number, day: number;
    if (h.yearFirst) [year, month, day] = [h.a, h.b, h.c];
    else if (monthFirst) [month, day, year] = [h.a, h.b, h.c];
    else [day, month, year] = [h.a, h.b, h.c];

    current = { at: new Date(fullYear(year), month - 1, day, h.hour, h.minute), sender, text: body };
    out.push(current);
  });

  if (out.length === 0) return null;
  for (const m of out) m.text = m.text.replace(/\n+$/, '');
  return out;
}
