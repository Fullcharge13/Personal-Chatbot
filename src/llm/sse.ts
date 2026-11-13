import { LlmError } from './provider';

/** Reads a server-sent-event body and hands each `data:` payload to onData. */
export async function readSse(res: Response, onData: (data: string) => void): Promise<void> {
  if (!res.body) throw new LlmError('other', '응답 본문이 없습니다');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handle = (line: string) => {
    const clean = line.replace(/\r$/, '');
    if (clean.startsWith('data:')) onData(clean.slice(5).trim());
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(handle);
    }
  } catch (e) {
    if (e instanceof LlmError) throw e;
    throw new LlmError('network', e instanceof Error ? e.message : '네트워크 오류');
  }
  if (buffer) handle(buffer);
}

export function parseJson(data: string): Record<string, any> | null {
  try {
    const value = JSON.parse(data);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}
