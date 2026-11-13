import type { LlmProvider } from '../llm/provider';

export function ChatScreen(_props: { llm: LlmProvider | null; now?: () => number; onGoTo?: (tab: 'persona' | 'settings') => void }) {
  return (
    <div className="screen">
      <h1>대화</h1>
    </div>
  );
}
