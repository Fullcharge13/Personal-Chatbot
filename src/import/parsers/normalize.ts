/** Strips the BOM and carriage returns, then splits into lines. */
export function toLines(text: string): string[] {
  return text.replace(/^﻿/, '').replace(/\r/g, '').split('\n');
}

export function to24h(ampm: string | undefined, hour: number): number {
  if (!ampm) return hour;
  const pm = /오후|PM/i.test(ampm);
  if (pm) return hour === 12 ? 12 : hour + 12;
  return hour === 12 ? 0 : hour;
}
