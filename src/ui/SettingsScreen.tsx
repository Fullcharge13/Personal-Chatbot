import { useEffect, useState } from 'react';
import { exportBackup, importBackup } from '../db/backup';
import { getSettings, saveSettings, wipeAll } from '../db/store';
import { DEFAULT_MODEL } from '../types';
import { readFileText } from './readFile';

export function SettingsScreen({ onSaved }: { onSaved?: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => {
    getSettings().then((s) => {
      setApiKey(s.apiKey);
      setModel(s.model);
      setLoaded(true);
    });
  }, []);

  if (!loaded) return null;

  async function save() {
    const next = model.trim() || DEFAULT_MODEL;
    await saveSettings({ apiKey: apiKey.trim(), provider: 'anthropic', model: next });
    setModel(next);
    setNotice('저장했습니다');
    onSaved?.();
  }

  async function download() {
    const blob = new Blob([await exportBackup()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chatbot-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function restore(file: File | undefined) {
    if (!file) return;
    try {
      await importBackup(await readFileText(file));
      const s = await getSettings();
      setModel(s.model);
      setNotice('백업을 불러왔습니다');
      onSaved?.();
    } catch {
      setNotice('백업 파일을 읽을 수 없습니다');
    }
  }

  async function wipe() {
    await wipeAll();
    setApiKey('');
    setModel(DEFAULT_MODEL);
    setConfirmText('');
    setNotice('모든 데이터를 삭제했습니다');
    onSaved?.();
  }

  return (
    <div className="screen">
      <h1>설정</h1>

      <section className="card">
        <label htmlFor="api-key">API 키</label>
        <input
          id="api-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-ant-..."
        />
        <p className="hint">이 휴대폰에만 저장됩니다. 백업 파일에도 들어가지 않습니다.</p>
        <label htmlFor="model">모델</label>
        <input id="model" value={model} onChange={(e) => setModel(e.target.value)} />
        <button className="primary" onClick={save}>
          저장
        </button>
      </section>

      <section className="card">
        <h2>백업</h2>
        <p className="hint">브라우저 데이터를 지우면 대화와 인물이 모두 사라집니다. 가끔 백업해 두세요.</p>
        <button onClick={download}>백업 내보내기</button>
        <label htmlFor="backup-file" className="file-label">
          백업 가져오기
        </label>
        <input
          id="backup-file"
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            void restore(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <p className="hint">가져오면 지금 있는 데이터는 백업 내용으로 바뀝니다.</p>
      </section>

      <section className="card danger">
        <h2>전체 삭제</h2>
        <label htmlFor="wipe-confirm">삭제하려면 "삭제"라고 입력</label>
        <input id="wipe-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        <button className="danger" disabled={confirmText !== '삭제'} onClick={wipe}>
          전체 삭제
        </button>
      </section>

      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
    </div>
  );
}
