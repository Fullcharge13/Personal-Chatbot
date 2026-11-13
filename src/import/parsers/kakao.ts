import type { ParsedMessage } from '../../types';
import { to24h, toLines } from './normalize';

// 오전/오후 or AM/PM may come before or after the time, or be absent (24-hour setting).
const TIME = '(?:(오전|오후|AM|PM) )?(\\d{1,2}):(\\d{2})(?: (AM|PM))?';
const ANDROID_PREFIX = new RegExp(`^(\\d{4})년 (\\d{1,2})월 (\\d{1,2})일 ${TIME}`);
const IOS_PREFIX = new RegExp(`^(\\d{4})\\. (\\d{1,2})\\. (\\d{1,2})\\. ${TIME}`);
const PC_SEPARATOR = /^-+ (\d{4})년 (\d{1,2})월 (\d{1,2})일 .*-+$/;
const PC_MESSAGE = new RegExp(`^\\[(.+?)\\] \\[${TIME}\\] (.*)$`);
const DATE_ONLY = /^\d{4}년 \d{1,2}월 \d{1,2}일( [월화수목금토일]요일)?$/;
const SYSTEM = /님이 (들어왔습니다|나갔습니다)\.$|님을 초대했습니다\.$|^저장한 날짜 : |님과 카카오톡 대화$|카카오톡 대화$/;

/** Parses a KakaoTalk export (Android, iOS or PC). Returns null when the text is not one. */
export function parseKakao(text: string): ParsedMessage[] | null {
  const out: ParsedMessage[] = [];
  let current: ParsedMessage | null = null;
  let pcDate: [number, number, number] | null = null;

  const close = () => {
    current = null;
  };
  const open = (at: Date, sender: string, body: string) => {
    current = { at, sender, text: body };
    out.push(current);
  };

  for (const line of toLines(text)) {
    const prefix = ANDROID_PREFIX.exec(line) ?? IOS_PREFIX.exec(line);
    if (prefix) {
      const [whole, y, mo, d, before, h, mi, after] = prefix;
      const ampm = before ?? after;
      const rest = line.slice(whole.length);
      const msg = /^, (.+?) : (.*)$/.exec(rest);
      if (msg) {
        open(new Date(+y, +mo - 1, +d, to24h(ampm, +h), +mi), msg[1], msg[2]);
      } else {
        close(); // date-only line or a system notice
      }
      continue;
    }

    const sep = PC_SEPARATOR.exec(line);
    if (sep) {
      pcDate = [+sep[1], +sep[2] - 1, +sep[3]];
      close();
      continue;
    }

    const pc = pcDate ? PC_MESSAGE.exec(line) : null;
    if (pc && pcDate) {
      const [, sender, before, h, mi, after, body] = pc;
      const ampm = before ?? after;
      open(new Date(pcDate[0], pcDate[1], pcDate[2], to24h(ampm, +h), +mi), sender, body);
      continue;
    }

    if (DATE_ONLY.test(line) || SYSTEM.test(line)) {
      close();
      continue;
    }

    if (current) (current as ParsedMessage).text += '\n' + line;
  }

  if (out.length === 0) return null;
  for (const m of out) m.text = m.text.replace(/\n+$/, '');
  return out;
}
