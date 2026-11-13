import type { LlmProvider } from '../llm/provider';

export function PersonaScreen(_props: { llm: LlmProvider | null }) {
  return (
    <div className="screen">
      <h1>인물</h1>
    </div>
  );
}
