import { useCallback, useEffect, useState } from 'react';
import { createPersona, deleteMemory, getActivePersona, listMemories, updatePersona } from '../db/store';
import type { LlmProvider } from '../llm/provider';
import { EMPTY_SHEET, type Memory, type Persona, type PersonaSheet } from '../types';
import { ImportWizard } from './ImportWizard';
import { SHEET_FIELDS } from './sheetFields';

const toSheet = (p: Persona): PersonaSheet => ({
  name: p.name,
  relation: p.relation,
  personality: p.personality,
  speechStyle: p.speechStyle,
  background: p.background,
  notes: p.notes,
});

export function PersonaScreen({ llm }: { llm: LlmProvider | null }) {
  const [loaded, setLoaded] = useState(false);
  /** null while creating a new persona. */
  const [persona, setPersona] = useState<Persona | null>(null);
  const [form, setForm] = useState<PersonaSheet>(EMPTY_SHEET);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    const active = (await getActivePersona()) ?? null;
    setPersona(active);
    setForm(active ? toSheet(active) : EMPTY_SHEET);
    setMemories(active ? await listMemories(active.id) : []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded) return null;

  async function save() {
    if (!form.name.trim()) {
      setNotice('이름을 넣어주세요');
      return;
    }
    if (persona) await updatePersona(persona.id, form);
    else await createPersona(form);
    await load();
    setNotice('저장했습니다');
  }

  function startNew() {
    setPersona(null);
    setForm(EMPTY_SHEET);
    setMemories([]);
    setConfirming(false);
    setNotice('');
  }

  async function removeMemory(id: string) {
    await deleteMemory(id);
    setMemories((list) => list.filter((m) => m.id !== id));
  }

  return (
    <div className="screen">
      <h1>인물</h1>
      <p className="hint">게임 캐릭터를 만들듯 설정을 적어주세요. 대화 파일을 넣으면 초안을 자동으로 채워줍니다.</p>

      {importing ? (
        <ImportWizard
          llm={llm}
          target={persona}
          onDone={() => {
            setImporting(false);
            void load();
          }}
        />
      ) : (
        <button onClick={() => setImporting(true)}>대화 파일 가져오기</button>
      )}

      <section className="card">
        {SHEET_FIELDS.map((f) => (
          <div key={f.key}>
            <label htmlFor={`sheet-${f.key}`}>{f.label}</label>
            <textarea
              id={`sheet-${f.key}`}
              rows={f.rows}
              placeholder={f.hint}
              value={form[f.key]}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
            />
          </div>
        ))}
        <button className="primary" onClick={() => void save()}>
          저장
        </button>
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
      </section>

      {persona && (
        <section className="card">
          <h2>기억 ({memories.length}개)</h2>
          {memories.length === 0 && <p className="hint">아직 기억이 없습니다. 대화하거나 대화 파일을 가져오면 쌓입니다.</p>}
          <ul className="memory-list">
            {memories.map((m) => (
              <li key={m.id}>
                <span>
                  {m.date ? `(${m.date}) ` : ''}
                  {m.text}
                </span>
                <button onClick={() => void removeMemory(m.id)}>삭제</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {persona && (
        <section className="card">
          {confirming ? (
            <>
              <p>지금 인물의 설정과 기억은 보관됩니다. 새 인물을 만들까요?</p>
              <div className="row">
                <button onClick={startNew}>새 인물 만들기</button>
                <button onClick={() => setConfirming(false)}>취소</button>
              </div>
            </>
          ) : (
            <button onClick={() => setConfirming(true)}>새 인물로 바꾸기</button>
          )}
        </section>
      )}
    </div>
  );
}
