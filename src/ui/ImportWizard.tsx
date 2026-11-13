import { useMemo, useRef, useState } from 'react';
import { addMemories, createPersona, updatePersona } from '../db/store';
import { chunkMessages, extractPersona, type ExtractionOutput, type ExtractionState } from '../import/extractor';
import { filterByPeriod, listSenders, parseChatExport, type ChatFormat, type Period } from '../import/parsers';
import { LlmError, type LlmProvider } from '../llm/provider';
import { LIMITS, type ParsedMessage, type Persona, type PersonaSheet } from '../types';
import { readFileText } from './readFile';
import { SHEET_FIELDS } from './sheetFields';

const FORMAT_LABEL: Record<ChatFormat, string> = { kakao: '카카오톡', whatsapp: '왓츠앱' };
const PERIODS: { id: Period; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: '1y', label: '최근 1년' },
  { id: '3m', label: '최근 3개월' },
];
const REMINDER_KEY = 'backup-reminder-shown';

type Step = 'file' | 'who' | 'period' | 'run' | 'review' | 'reminder';
type Choice = 'keep' | 'new';

function reminderAlreadyShown(): boolean {
  try {
    return localStorage.getItem(REMINDER_KEY) === '1';
  } catch {
    return true;
  }
}

export function ImportWizard({
  llm,
  target,
  onDone,
  now = Date.now,
}: {
  llm: LlmProvider | null;
  /** The persona to merge into, or null to create a new one. */
  target: Persona | null;
  onDone: () => void;
  now?: () => number;
}) {
  const [step, setStep] = useState<Step>('file');
  const [error, setError] = useState('');
  const [format, setFormat] = useState<ChatFormat>('kakao');
  const [messages, setMessages] = useState<ParsedMessage[]>([]);
  const [who, setWho] = useState('');
  const [me, setMe] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [canResume, setCanResume] = useState(false);
  const [output, setOutput] = useState<ExtractionOutput | null>(null);
  const [draft, setDraft] = useState<PersonaSheet | null>(null);
  const [choices, setChoices] = useState<Partial<Record<keyof PersonaSheet, Choice>>>({});
  const resumeState = useRef<ExtractionState | undefined>(undefined);

  const senders = useMemo(() => listSenders(messages), [messages]);
  const chunks = useMemo(
    () => chunkMessages(filterByPeriod(messages, period, new Date(now())), who, me),
    [messages, period, who, me, now],
  );
  const selected = useMemo(() => filterByPeriod(messages, period, new Date(now())), [messages, period, now]);
  const chars = chunks.reduce((n, c) => n + c.length, 0);

  async function pick(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = parseChatExport(await readFileText(file));
      setFormat(parsed.format);
      setMessages(parsed.messages);
      setError('');
      setStep('who');
    } catch {
      setError('지원하지 않는 형식입니다. 카카오톡 또는 왓츠앱 내보내기 txt 파일을 넣어주세요');
    }
  }

  async function run(resume: boolean) {
    if (!llm) return;
    if (!resume) resumeState.current = undefined;
    setError('');
    setCanResume(false);
    setProgress([resumeState.current?.done ?? 0, chunks.length]);
    setStep('run');
    try {
      const result = await extractPersona({
        chunks,
        target: who,
        me,
        llm,
        resume: resumeState.current,
        onState: (s) => (resumeState.current = s),
        onProgress: (done, total) => setProgress([done, total]),
      });
      setOutput(result);
      prepareReview(result);
      setStep('review');
    } catch (e) {
      if (e instanceof Error && e.message === 'EXTRACTION_EMPTY') {
        setError('대화에서 인물 정보를 읽어내지 못했습니다. 다시 시도하거나 다른 기간을 골라주세요');
        resumeState.current = undefined;
      } else {
        setError(e instanceof LlmError ? e.message : '추출 중 문제가 생겼습니다');
        setCanResume(true);
      }
    }
  }

  function prepareReview(result: ExtractionOutput) {
    const nextChoices: Partial<Record<keyof PersonaSheet, Choice>> = {};
    const nextDraft = { ...result.sheet };
    if (target) {
      for (const { key } of SHEET_FIELDS) {
        const old = target[key].trim();
        const fresh = result.sheet[key].trim();
        if (old && fresh && old !== fresh) {
          nextChoices[key] = 'keep';
          nextDraft[key] = target[key];
        } else {
          nextDraft[key] = fresh ? result.sheet[key] : target[key];
        }
      }
    }
    setChoices(nextChoices);
    setDraft(nextDraft);
  }

  function choose(key: keyof PersonaSheet, choice: Choice) {
    if (!target || !output) return;
    setChoices((c) => ({ ...c, [key]: choice }));
    setDraft((d) => ({ ...d!, [key]: choice === 'keep' ? target[key] : output.sheet[key] }));
  }

  async function save() {
    if (!draft || !output) return;
    if (!draft.name.trim()) {
      setError('이름을 넣어주세요');
      return;
    }
    const memories = output.memories.map((m) => ({ ...m, source: 'import' as const }));
    if (target) {
      const samples = [...new Set([...output.speechSamples, ...target.speechSamples])].slice(0, LIMITS.speechSamples);
      await updatePersona(target.id, { ...draft, speechSamples: samples });
      if (memories.length) await addMemories(target.id, memories);
    } else {
      const created = await createPersona(draft, output.speechSamples);
      if (memories.length) await addMemories(created.id, memories);
    }
    if (reminderAlreadyShown()) {
      onDone();
      return;
    }
    try {
      localStorage.setItem(REMINDER_KEY, '1');
    } catch {
      // storage unavailable: the reminder simply shows again next time
    }
    setStep('reminder');
  }

  return (
    <section className="card">
      <h2>대화 파일 가져오기</h2>

      {step === 'file' && (
        <>
          <p className="hint">
            카카오톡 또는 왓츠앱에서 "대화 내보내기"로 만든 txt 파일을 넣어주세요. 파일은 저장하지 않고, 뽑아낸 말투와
            기억만 저장합니다.
          </p>
          <label htmlFor="chat-file">대화 내보내기 파일 (txt)</label>
          <input
            id="chat-file"
            type="file"
            accept=".txt,text/plain"
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </>
      )}

      {step === 'who' && (
        <>
          <p className="hint">
            {FORMAT_LABEL[format]} 대화, 메시지 {messages.length}개
          </p>
          <label htmlFor="who">인물이 될 사람</label>
          <select id="who" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">선택</option>
            {senders.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.count}개)
              </option>
            ))}
          </select>
          <label htmlFor="me">나</label>
          <select id="me" value={me} onChange={(e) => setMe(e.target.value)}>
            <option value="">선택</option>
            {senders.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.count}개)
              </option>
            ))}
          </select>
          {who && who === me && <p className="hint error">서로 다른 사람을 골라주세요</p>}
          <button className="primary" disabled={!who || !me || who === me} onClick={() => setStep('period')}>
            다음
          </button>
        </>
      )}

      {step === 'period' && (
        <>
          <div role="radiogroup" aria-label="사용할 기간">
            {PERIODS.map((p) => (
              <label key={p.id} className="choice">
                <input type="radio" name="period" checked={period === p.id} onChange={() => setPeriod(p.id)} />
                {p.label}
              </label>
            ))}
          </div>
          {selected.length === 0 ? (
            <p className="hint error">이 기간에는 메시지가 없습니다</p>
          ) : (
            <p className="hint">
              메시지 {selected.length}개, {chunks.length}개 구간 (AI 호출 {chunks.length + 1}회, 입력 약{' '}
              {chars.toLocaleString()}자). 구간이 많을수록 시간과 AI 사용료가 늘어납니다.
            </p>
          )}
          {!llm && <p className="hint error">설정에서 API 키를 먼저 넣어주세요</p>}
          <button className="primary" disabled={!llm || selected.length === 0} onClick={() => void run(false)}>
            추출 시작
          </button>
        </>
      )}

      {step === 'run' && (
        <>
          <p>
            {progress[0]} / {progress[1]} 구간
          </p>
          <progress value={progress[0]} max={Math.max(progress[1], 1)} />
          {!error && <p className="hint">화면을 끄거나 다른 앱으로 가지 말고 기다려주세요.</p>}
          {error && (
            <div className="row">
              {canResume ? (
                <button onClick={() => void run(true)}>이어서 다시 시도</button>
              ) : (
                <>
                  <button onClick={() => void run(false)}>처음부터 다시 시도</button>
                  <button onClick={() => (setError(''), setStep('period'))}>기간 다시 고르기</button>
                </>
              )}
            </div>
          )}
        </>
      )}

      {step === 'review' && draft && output && (
        <>
          <p className="hint">
            초안입니다. 고친 뒤 저장하세요. 기억 {output.memories.length}개, 말투 예시 {output.speechSamples.length}개를
            함께 저장합니다.
          </p>
          {output.skippedChunks > 0 && (
            <p className="hint error">{output.skippedChunks}개 구간을 읽지 못해 건너뛰었습니다</p>
          )}
          {SHEET_FIELDS.map((f) => (
            <div key={f.key}>
              <label htmlFor={`draft-${f.key}`}>{f.label}</label>
              {choices[f.key] && (
                <div className="choice">
                  <label>
                    <input
                      type="radio"
                      name={`choice-${f.key}`}
                      checked={choices[f.key] === 'keep'}
                      onChange={() => choose(f.key, 'keep')}
                    />
                    기존 유지
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`choice-${f.key}`}
                      checked={choices[f.key] === 'new'}
                      onChange={() => choose(f.key, 'new')}
                    />
                    새 내용 사용
                  </label>
                </div>
              )}
              <textarea
                id={`draft-${f.key}`}
                rows={f.rows}
                value={draft[f.key]}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              />
            </div>
          ))}
          <button className="primary" onClick={() => void save()}>
            저장
          </button>
        </>
      )}

      {step === 'reminder' && (
        <>
          <p>
            가져오기를 마쳤습니다. 브라우저 데이터를 지우면 이 내용이 사라지니, 설정에서 백업을 내보내 두세요.
          </p>
          <button className="primary" onClick={onDone}>
            확인
          </button>
        </>
      )}

      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {step !== 'run' && step !== 'reminder' && (
        <button className="link" onClick={onDone}>
          닫기
        </button>
      )}
    </section>
  );
}
