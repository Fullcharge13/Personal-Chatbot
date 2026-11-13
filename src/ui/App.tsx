import { useCallback, useEffect, useState } from 'react';
import { getSettings } from '../db/store';
import { createAnthropicProvider } from '../llm/anthropic';
import type { LlmProvider } from '../llm/provider';
import type { Settings } from '../types';
import { ChatScreen } from './ChatScreen';
import { PersonaScreen } from './PersonaScreen';
import { ProfileScreen } from './ProfileScreen';
import { SettingsScreen } from './SettingsScreen';

const TABS = [
  { id: 'chat', label: '대화' },
  { id: 'persona', label: '인물' },
  { id: 'profile', label: '내 정보' },
  { id: 'settings', label: '설정' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function App({ llmFactory = createAnthropicProvider }: { llmFactory?: (s: Settings) => LlmProvider }) {
  const [tab, setTab] = useState<TabId>('chat');
  const [llm, setLlm] = useState<LlmProvider | null>(null);
  const [ready, setReady] = useState(false);
  // Bumped when stored data is replaced wholesale (backup import, wipe) so screens reload.
  const [epoch, setEpoch] = useState(0);
  const [locked, setLocked] = useState(false);

  const reload = useCallback(async () => {
    const s = await getSettings();
    setLlm(s.apiKey ? llmFactory(s) : null);
    setEpoch((n) => n + 1);
    setReady(true);
  }, [llmFactory]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Everything lives in browser storage; ask the browser not to evict it under pressure.
  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => {});
  }, []);

  return (
    <div className="app">
      <main>
        {ready && tab === 'chat' && <ChatScreen key={epoch} llm={llm} onGoTo={setTab} />}
        {ready && tab === 'persona' && <PersonaScreen key={epoch} llm={llm} onBusyChange={setLocked} />}
        {ready && tab === 'profile' && <ProfileScreen key={epoch} />}
        {ready && tab === 'settings' && <SettingsScreen onSaved={reload} />}
      </main>
      {locked && <p className="lock-note">대화 파일을 가져오는 동안에는 다른 탭으로 갈 수 없습니다</p>}
      <nav role="tablist" className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            disabled={locked && tab !== t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
