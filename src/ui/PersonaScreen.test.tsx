import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonaScreen } from './PersonaScreen';
import * as s from '../db/store';
import { mem, sheet } from '../test-helpers';

beforeEach(() => s.wipeAll());

test('no persona: shows an empty sheet form; saving creates the active persona', async () => {
  const user = userEvent.setup();
  render(<PersonaScreen llm={null} />);
  const name = await screen.findByLabelText('이름');
  expect(name).toHaveValue('');
  expect(screen.queryByRole('button', { name: '새 인물로 바꾸기' })).not.toBeInTheDocument();
  await user.type(name, '지수');
  await user.type(screen.getByLabelText('말투'), '반말');
  await user.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(async () => expect(await s.getActivePersona()).toMatchObject({ name: '지수', speechStyle: '반말' }));
  expect(screen.getByText('저장했습니다')).toBeInTheDocument();
});

test('saving without a name shows an error and creates nothing', async () => {
  const user = userEvent.setup();
  render(<PersonaScreen llm={null} />);
  await screen.findByLabelText('이름');
  await user.click(screen.getByRole('button', { name: '저장' }));
  expect(await screen.findByText('이름을 넣어주세요')).toBeInTheDocument();
  expect(await s.getActivePersona()).toBeUndefined();
});

test('all six sheet fields load; editing one and saving updates the same persona', async () => {
  const user = userEvent.setup();
  const p = await s.createPersona({ ...sheet('지수'), background: '서울', notes: '메모' });
  render(<PersonaScreen llm={null} />);
  expect(await screen.findByLabelText('이름')).toHaveValue('지수');
  expect(screen.getByLabelText('관계')).toHaveValue('친구');
  expect(screen.getByLabelText('성격')).toHaveValue('다정함');
  expect(screen.getByLabelText('말투')).toHaveValue('반말');
  expect(screen.getByLabelText('배경 설정')).toHaveValue('서울');
  expect(screen.getByLabelText('메모')).toHaveValue('메모');
  await user.clear(screen.getByLabelText('성격'));
  await user.type(screen.getByLabelText('성격'), '무뚝뚝함');
  await user.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(async () => expect((await s.getActivePersona())!.personality).toBe('무뚝뚝함'));
  expect((await s.getActivePersona())!.id).toBe(p.id);
});

test('"새 인물로 바꾸기" asks for confirmation, then an empty form creates a new persona; old data remains', async () => {
  const user = userEvent.setup();
  const old = await s.createPersona(sheet('지수'));
  await s.addMemories(old.id, [mem('제주도 감')]);
  render(<PersonaScreen llm={null} />);
  await user.click(await screen.findByRole('button', { name: '새 인물로 바꾸기' }));
  expect(screen.getByText(/지금 인물의 설정과 기억은 보관됩니다/)).toBeInTheDocument();
  expect(screen.getByLabelText('이름')).toHaveValue('지수');
  await user.click(screen.getByRole('button', { name: '새 인물 만들기' }));
  expect(screen.getByLabelText('이름')).toHaveValue('');
  expect(screen.queryByText('제주도 감')).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('이름'), '철수');
  await user.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(async () => expect((await s.getActivePersona())!.name).toBe('철수'));
  expect(await s.listMemories(old.id)).toHaveLength(1);
  expect(await s.db.personas.count()).toBe(2);
});

test('cancelling the switch keeps the current persona', async () => {
  const user = userEvent.setup();
  await s.createPersona(sheet('지수'));
  render(<PersonaScreen llm={null} />);
  await user.click(await screen.findByRole('button', { name: '새 인물로 바꾸기' }));
  await user.click(screen.getByRole('button', { name: '취소' }));
  expect(screen.getByLabelText('이름')).toHaveValue('지수');
});

test('memory list shows memories and deleting one removes it', async () => {
  const user = userEvent.setup();
  const p = await s.createPersona(sheet('지수'));
  await s.addMemories(p.id, [mem('제주도 감', [], '2024-03-01'), mem('면접 봄')]);
  render(<PersonaScreen llm={null} />);
  expect(await screen.findByText('기억 (2개)')).toBeInTheDocument();
  const row = screen.getByText(/제주도 감/).closest('li')!;
  await user.click(within(row).getByRole('button', { name: '삭제' }));
  await waitFor(() => expect(screen.queryByText(/제주도 감/)).not.toBeInTheDocument());
  expect((await s.listMemories(p.id)).map((m) => m.text)).toEqual(['면접 봄']);
});

test('"대화 파일 가져오기" opens the wizard', async () => {
  const user = userEvent.setup();
  render(<PersonaScreen llm={null} />);
  await user.click(await screen.findByRole('button', { name: '대화 파일 가져오기' }));
  expect(screen.getByLabelText('대화 내보내기 파일 (txt)')).toBeInTheDocument();
});
