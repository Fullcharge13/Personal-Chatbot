import { useEffect, useState } from 'react';
import { getProfile, saveProfileEntry } from '../db/store';
import type { ProfileEntry } from '../types';
import { readFileText } from './readFile';

export function ProfileScreen() {
  const [entries, setEntries] = useState<ProfileEntry[] | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    getProfile().then(setEntries);
  }, []);

  if (!entries) return null;

  const setText = (key: string, update: (old: string) => string) =>
    setEntries((list) => list!.map((e) => (e.key === key ? { ...e, text: update(e.text) } : e)));

  async function attach(key: string, file: File | undefined) {
    if (!file) return;
    if (!/\.txt$/i.test(file.name)) {
      setNotice('txt 파일만 넣을 수 있습니다');
      return;
    }
    const text = (await readFileText(file)).replace(/^﻿/, '').trim();
    setText(key, (old) => (old.trim() ? `${old.trimEnd()}\n${text}` : text));
    setNotice('');
  }

  async function save() {
    await Promise.all(entries!.map((e) => saveProfileEntry(e.key, e.text)));
    setNotice('저장했습니다');
  }

  return (
    <div className="screen">
      <h1>내 정보</h1>
      <p className="hint">여기 적은 내용을 인물이 알고 대화합니다. 비워 둬도 됩니다.</p>
      {entries.map((e) => (
        <section className="card" key={e.key}>
          <label htmlFor={`profile-${e.key}`}>{e.label}</label>
          <textarea
            id={`profile-${e.key}`}
            rows={5}
            value={e.text}
            onChange={(ev) => setText(e.key, () => ev.target.value)}
          />
          <label htmlFor={`profile-file-${e.key}`} className="file-label">
            {e.label} txt 첨부
          </label>
          <input
            id={`profile-file-${e.key}`}
            type="file"
            accept=".txt,text/plain"
            onChange={(ev) => {
              void attach(e.key, ev.target.files?.[0]);
              ev.target.value = '';
            }}
          />
        </section>
      ))}
      <button className="primary" onClick={save}>
        저장
      </button>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
    </div>
  );
}
