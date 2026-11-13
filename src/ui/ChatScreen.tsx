import { useEffect, useRef, useState } from 'react';
import { consolidate } from '../chat/consolidate';
import { openIfDue } from '../chat/opener';
import { buildChatRequest } from '../chat/prompt';
import * as store from '../db/store';
import { LlmError, type LlmProvider } from '../llm/provider';
import { LIMITS, type ChatMessage, type Persona } from '../types';

interface Banner {
  text: string;
  toSettings?: boolean;
}

function bannerFor(e: unknown): Banner {
  if (e instanceof LlmError) {
    if (e.kind === 'auth') return { text: 'API 키를 확인해주세요', toSettings: true };
    if (e.kind === 'network') return { text: '전송하지 못했습니다. 연결을 확인해주세요' };
    return { text: e.message };
  }
  return { text: '답변을 받지 못했습니다' };
}

const isQuotaError = (e: unknown) => {
  const err = e as { name?: string; inner?: { name?: string } } | null;
  return err?.name === 'QuotaExceededError' || err?.inner?.name === 'QuotaExceededError';
};

export function ChatScreen({
  llm,
  now = Date.now,
  onGoTo,
}: {
  llm: LlmProvider | null;
  now?: () => number;
  onGoTo?: (tab: 'persona' | 'settings') => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Load, then tidy up the previous conversation and let the persona speak first if it has been a while.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const active = (await store.getActivePersona()) ?? null;
      if (cancelled) return;
      setPersona(active);
      if (active) setMessages(await store.listMessages(active.id));
      setLoaded(true);
      if (!active || !llm) return;
      await consolidate(active.id, llm);
      await openIfDue(active.id, llm, now());
      if (!cancelled) setMessages(await store.listMessages(active.id));
    })();
    return () => {
      cancelled = true;
    };
  }, [llm, now]);

  // Leaving the app is the natural end of a conversation.
  useEffect(() => {
    if (!persona || !llm) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden') void consolidate(persona.id, llm);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [persona, llm]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, streaming]);

  if (!loaded) return null;

  if (!persona) {
    return (
      <div className="empty">
        <p>인물 탭에서 인물을 먼저 만들어주세요</p>
        <button onClick={() => onGoTo?.('persona')}>인물 만들러 가기</button>
      </div>
    );
  }

  const nextTimestamp = (after: number | undefined) => Math.max(now(), (after ?? 0) + 1);

  async function reply(userMessage: ChatMessage) {
    if (!llm || !persona) return;
    setBusy(true);
    setBanner(null);
    setStreaming('');
    try {
      const request = buildChatRequest({
        persona,
        profile: await store.getProfile(),
        summary: (await store.getSummary(persona.id))?.text,
        allMemories: await store.listMemories(persona.id),
        recent: await store.listMessages(persona.id, LIMITS.recentMessages),
        now: new Date(now()),
      });
      const full = (await llm.stream(request, (delta) => setStreaming((s) => (s ?? '') + delta))).trim();
      if (!full) throw new LlmError('other', '빈 답변을 받았습니다. 다시 보내보세요');
      const saved = await store.addMessage({
        personaId: persona.id,
        sender: 'persona',
        text: full,
        at: nextTimestamp(userMessage.at),
      });
      setMessages((list) => [...list, saved]);
    } catch (e) {
      await store.updateMessage(userMessage.id, { failed: true }).catch(() => {});
      setMessages((list) => list.map((m) => (m.id === userMessage.id ? { ...m, failed: true } : m)));
      setBanner(bannerFor(e));
    } finally {
      setStreaming(null);
      setBusy(false);
    }
  }

  async function submit() {
    const text = input.trim();
    if (!text || busy || !llm || !persona) return;
    let message: ChatMessage;
    try {
      message = await store.addMessage({
        personaId: persona.id,
        sender: 'user',
        text,
        at: nextTimestamp(messages[messages.length - 1]?.at),
      });
    } catch (e) {
      setBanner({
        text: isQuotaError(e)
          ? '저장 공간이 부족합니다. 설정에서 백업을 내보내주세요'
          : '메시지를 저장하지 못했습니다',
      });
      return;
    }
    setInput('');
    setMessages((list) => [...list, message]);
    await reply(message);
  }

  async function retry(message: ChatMessage) {
    if (busy) return;
    await store.updateMessage(message.id, { failed: false });
    const fresh = { ...message, failed: false };
    setMessages((list) => list.map((m) => (m.id === message.id ? fresh : m)));
    await reply(fresh);
  }

  return (
    <div className="chat">
      <header>
        <h1 style={{ margin: 0, fontSize: 17 }}>{persona.name}</h1>
      </header>

      <div className="log">
        {messages.map((m) => (
          <div key={m.id} style={{ display: 'contents' }}>
            <div className={`bubble ${m.sender}${m.failed ? ' failed' : ''}`}>{m.text}</div>
            {m.failed && (
              <button className="link retry" onClick={() => void retry(m)}>
                다시 보내기
              </button>
            )}
          </div>
        ))}
        {streaming !== null && <div className="bubble persona">{streaming || '…'}</div>}
        <div ref={endRef} />
      </div>

      {!llm && <p className="banner">설정에서 API 키를 넣어주세요</p>}
      {banner && (
        <div role="alert" className="banner">
          <span>{banner.text}</span>
          {banner.toSettings && (
            <>
              {' '}
              <button className="link" onClick={() => onGoTo?.('settings')}>
                설정으로 가기
              </button>
            </>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          aria-label="메시지"
          rows={1}
          value={input}
          disabled={!llm}
          onChange={(e) => setInput(e.target.value)}
          placeholder="메시지 입력"
        />
        <button type="submit" disabled={!llm || busy || !input.trim()}>
          보내기
        </button>
      </form>
    </div>
  );
}
