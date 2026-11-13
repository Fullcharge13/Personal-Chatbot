import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsScreen } from './SettingsScreen';
import * as s from '../db/store';
import { sheet } from '../test-helpers';

beforeEach(() => s.wipeAll());

test('api key input is type=password; model defaults to claude-sonnet-5-5; saving persists', async () => {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  render(<SettingsScreen onSaved={onSaved} />);
  const key = await screen.findByLabelText('API 키');
  expect(key).toHaveAttribute('type', 'password');
  expect(screen.getByLabelText('모델')).toHaveValue('claude-sonnet-5-5');
  await user.type(key, 'sk-abc');
  await user.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect((await s.getSettings()).apiKey).toBe('sk-abc');
  expect(screen.getByText('저장했습니다')).toBeInTheDocument();
});

test('an empty model name falls back to the default on save', async () => {
  const user = userEvent.setup();
  render(<SettingsScreen />);
  const model = await screen.findByLabelText('모델');
  await user.clear(model);
  await user.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(async () => expect((await s.getSettings()).model).toBe('claude-sonnet-5-5'));
});

test('"백업 내보내기" downloads a file whose content lacks the api key', async () => {
  const user = userEvent.setup();
  await s.saveSettings({ apiKey: 'sk-secret', provider: 'anthropic', model: 'm' });
  await s.createPersona(sheet('지수'));
  const blobs: Blob[] = [];
  URL.createObjectURL = vi.fn((b: Blob) => (blobs.push(b), 'blob:x'));
  URL.revokeObjectURL = vi.fn();
  render(<SettingsScreen />);
  await user.click(await screen.findByRole('button', { name: '백업 내보내기' }));
  await waitFor(() => expect(blobs).toHaveLength(1));
  const text = await blobs[0].text();
  expect(text).toContain('지수');
  expect(text).not.toContain('sk-secret');
});

test('importing an invalid file shows an error and keeps data', async () => {
  const user = userEvent.setup();
  const p = await s.createPersona(sheet('지수'));
  render(<SettingsScreen />);
  const input = await screen.findByLabelText('백업 가져오기');
  await user.upload(input, new File(['not json'], 'backup.json', { type: 'application/json' }));
  expect(await screen.findByText('백업 파일을 읽을 수 없습니다')).toBeInTheDocument();
  expect((await s.getActivePersona())!.id).toBe(p.id);
});

test('importing a valid backup restores data and reports success', async () => {
  const user = userEvent.setup();
  await s.createPersona(sheet('지수'));
  const { exportBackup } = await import('../db/backup');
  const json = await exportBackup();
  await s.wipeAll();
  const onSaved = vi.fn();
  render(<SettingsScreen onSaved={onSaved} />);
  await s.createPersona(sheet('지울 사람'));
  await user.upload(await screen.findByLabelText('백업 가져오기'), new File([json], 'backup.json', { type: 'application/json' }));
  expect(await screen.findByText(/인물 1명, 대화 0개, 기억 0개/)).toBeInTheDocument();
  expect((await s.getActivePersona())!.name).toBe('지울 사람');
  await user.click(screen.getByRole('button', { name: '이 백업으로 바꾸기' }));
  expect(await screen.findByText('백업을 불러왔습니다')).toBeInTheDocument();
  expect((await s.getActivePersona())!.name).toBe('지수');
  expect(onSaved).toHaveBeenCalled();
});

test('"전체 삭제" requires typing 삭제 before wiping', async () => {
  const user = userEvent.setup();
  await s.createPersona(sheet('지수'));
  render(<SettingsScreen />);
  const button = await screen.findByRole('button', { name: '전체 삭제' });
  expect(button).toBeDisabled();
  await user.type(screen.getByLabelText('삭제하려면 "삭제"라고 입력'), '삭제');
  expect(button).toBeEnabled();
  await user.click(button);
  await waitFor(async () => expect(await s.getActivePersona()).toBeUndefined());
});

test('cancelling a picked backup changes nothing', async () => {
  const user = userEvent.setup();
  const { exportBackup } = await import('../db/backup');
  await s.createPersona(sheet('지수'));
  const json = await exportBackup();
  await s.createPersona(sheet('철수'));
  render(<SettingsScreen />);
  await user.upload(await screen.findByLabelText('백업 가져오기'), new File([json], 'b.json', { type: 'application/json' }));
  await user.click(await screen.findByRole('button', { name: '취소' }));
  expect(screen.queryByRole('button', { name: '이 백업으로 바꾸기' })).not.toBeInTheDocument();
  expect((await s.getActivePersona())!.name).toBe('철수');
});
