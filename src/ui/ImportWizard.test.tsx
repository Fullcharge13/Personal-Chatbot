import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportWizard } from './ImportWizard';
import * as s from '../db/store';
import { createFakeProvider } from '../llm/fake';
import { LlmError, type LlmProvider, type LlmRequest } from '../llm/provider';
import { CHUNK_CHARS } from '../import/extractor';
import { sheet } from '../test-helpers';
import kakao from '../import/parsers/fixtures/kakao-android.txt?raw';

const NOW = () => new Date(2024, 2, 10).getTime();
const chunkReply = JSON.stringify({
  traits: ['장난기'], phrases: ['ㅋㅋ'], samples: ['안녕'],
  events: [{ text: '같이 제주도 감', date: '2024-03-01', keywords: ['제주도'] }],
});
const mergeReply = JSON.stringify({
  name: '홍길동', relation: '친구', personality: '장난기 많음', speechStyle: '반말', background: '서울', notes: '',
});
const file = (text: string, name = 'chat.txt') => new File([text], name, { type: 'text/plain' });

beforeEach(async () => {
  await s.wipeAll();
  localStorage.clear();
});

async function toPeriodStep(user: ReturnType<typeof userEvent.setup>, text = kakao) {
  await user.upload(screen.getByLabelText('대화 내보내기 파일 (txt)'), file(text));
  await user.selectOptions(await screen.findByLabelText('인물이 될 사람'), '홍길동');
  await user.selectOptions(screen.getByLabelText('나'), '나');
  await user.click(screen.getByRole('button', { name: '다음' }));
}

function bigExport(lines: number) {
  const body = '가'.repeat(100);
  return Array.from({ length: lines }, (_, i) => `2024년 3월 1일 오후 2:15, ${i % 2 ? '나' : '홍길동'} : ${body}`).join('\n');
}

test('unknown file shows the supported formats and saves nothing', async () => {
  const user = userEvent.setup();
  render(<ImportWizard llm={createFakeProvider([])} target={null} onDone={() => {}} now={NOW} />);
  await user.upload(screen.getByLabelText('대화 내보내기 파일 (txt)'), file('그냥 메모'));
  expect(
    await screen.findByText('지원하지 않는 형식입니다. 카카오톡 또는 왓츠앱 내보내기 txt 파일을 넣어주세요'),
  ).toBeInTheDocument();
  expect(await s.db.personas.count()).toBe(0);
});

test('lists senders by count; target and me must differ before continuing', async () => {
  const user = userEvent.setup();
  render(<ImportWizard llm={createFakeProvider([])} target={null} onDone={() => {}} now={NOW} />);
  await user.upload(screen.getByLabelText('대화 내보내기 파일 (txt)'), file(kakao));
  const target = await screen.findByLabelText('인물이 될 사람');
  expect(screen.getByText(/카카오톡 대화, 메시지 4개/)).toBeInTheDocument();
  expect(Array.from(target.querySelectorAll('option')).map((o) => o.textContent)).toEqual([
    '선택', '홍길동 (2개)', '나 (2개)',
  ]);
  const next = screen.getByRole('button', { name: '다음' });
  expect(next).toBeDisabled();
  await user.selectOptions(target, '홍길동');
  await user.selectOptions(screen.getByLabelText('나'), '홍길동');
  expect(next).toBeDisabled();
  expect(screen.getByText('서로 다른 사람을 골라주세요')).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('나'), '나');
  expect(next).toBeEnabled();
});

test('period options update the message and chunk estimate', async () => {
  const user = userEvent.setup();
  const old = '2022년 1월 1일 오후 2:15, 홍길동 : 옛날\n';
  render(<ImportWizard llm={createFakeProvider([])} target={null} onDone={() => {}} now={NOW} />);
  await toPeriodStep(user, old + kakao);
  expect(screen.getByLabelText('전체')).toBeChecked();
  expect(screen.getByText(/메시지 5개, 1개 구간/)).toBeInTheDocument();
  await user.click(screen.getByLabelText('최근 3개월'));
  expect(screen.getByText(/메시지 4개, 1개 구간/)).toBeInTheDocument();
  expect(screen.getByLabelText('최근 1년')).toBeInTheDocument();
});

test('a period with no messages disables extraction', async () => {
  const user = userEvent.setup();
  render(<ImportWizard llm={createFakeProvider([])} target={null} onDone={() => {}} now={() => new Date(2026, 0, 1).getTime()} />);
  await toPeriodStep(user);
  await user.click(screen.getByLabelText('최근 3개월'));
  expect(screen.getByText('이 기간에는 메시지가 없습니다')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '추출 시작' })).toBeDisabled();
});

test('without an api key the extract button is disabled with a hint', async () => {
  const user = userEvent.setup();
  render(<ImportWizard llm={null} target={null} onDone={() => {}} now={NOW} />);
  await toPeriodStep(user);
  expect(screen.getByRole('button', { name: '추출 시작' })).toBeDisabled();
  expect(screen.getByText('설정에서 API 키를 먼저 넣어주세요')).toBeInTheDocument();
});

test('progress text updates during extraction', async () => {
  const user = userEvent.setup();
  const releases: (() => void)[] = [];
  const calls: LlmRequest[] = [];
  const slow: LlmProvider = {
    complete: (req) => {
      calls.push(req);
      return new Promise((resolve) => releases.push(() => resolve(calls.length <= 2 ? chunkReply : mergeReply)));
    },
    stream: async () => '',
  };
  const lines = Math.ceil((CHUNK_CHARS * 1.5) / 120);
  render(<ImportWizard llm={slow} target={null} onDone={() => {}} now={NOW} />);
  await toPeriodStep(user, bigExport(lines));
  expect(screen.getByText(/2개 구간/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '추출 시작' }));
  expect(await screen.findByText('0 / 2 구간')).toBeInTheDocument();
  await waitFor(() => expect(releases).toHaveLength(1));
  releases[0]();
  expect(await screen.findByText('1 / 2 구간')).toBeInTheDocument();
  await waitFor(() => expect(releases).toHaveLength(2));
  releases[1]();
  expect(await screen.findByText('2 / 2 구간')).toBeInTheDocument();
});

test('on LlmError shows the error and resumes without re-sending finished chunks', async () => {
  const user = userEvent.setup();
  const fake = createFakeProvider([chunkReply, new LlmError('network', '연결이 끊겼습니다'), chunkReply, mergeReply]);
  const lines = Math.ceil((CHUNK_CHARS * 1.5) / 120);
  render(<ImportWizard llm={fake} target={null} onDone={() => {}} now={NOW} />);
  await toPeriodStep(user, bigExport(lines));
  await user.click(screen.getByRole('button', { name: '추출 시작' }));
  expect(await screen.findByText(/연결이 끊겼습니다/)).toBeInTheDocument();
  expect(fake.calls).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: '이어서 다시 시도' }));
  expect(await screen.findByLabelText('이름')).toHaveValue('홍길동');
  expect(fake.calls).toHaveLength(4);
  expect(fake.calls[2].messages[0].content).toBe(fake.calls[1].messages[0].content);
});

test('when every chunk is unreadable shows a plain message', async () => {
  const user = userEvent.setup();
  render(<ImportWizard llm={createFakeProvider(['음...'])} target={null} onDone={() => {}} now={NOW} />);
  await toPeriodStep(user);
  await user.click(screen.getByRole('button', { name: '추출 시작' }));
  expect(await screen.findByText(/대화에서 인물 정보를 읽어내지 못했습니다/)).toBeInTheDocument();
});

test('new persona: draft is editable; saving stores sheet, samples and import memories, not the raw file', async () => {
  const user = userEvent.setup();
  const onDone = vi.fn();
  render(<ImportWizard llm={createFakeProvider([chunkReply, mergeReply])} target={null} onDone={onDone} now={NOW} />);
  await toPeriodStep(user);
  await user.click(screen.getByRole('button', { name: '추출 시작' }));
  const relation = await screen.findByLabelText('관계');
  expect(relation).toHaveValue('친구');
  expect(screen.queryByLabelText('기존 유지')).not.toBeInTheDocument();
  await user.clear(relation);
  await user.type(relation, '대학 친구');
  await user.click(screen.getByRole('button', { name: '저장' }));
  await user.click(await screen.findByRole('button', { name: '확인' }));
  expect(onDone).toHaveBeenCalled();
  const p = (await s.getActivePersona())!;
  expect(p).toMatchObject({ name: '홍길동', relation: '대학 친구', speechStyle: '반말', speechSamples: ['안녕'] });
  const mems = await s.listMemories(p.id);
  expect(mems).toHaveLength(1);
  expect(mems[0]).toMatchObject({ source: 'import', text: '같이 제주도 감', keywords: ['제주도'] });
  const everything = JSON.stringify(await Promise.all(s.db.tables.map((t) => t.toArray())));
  expect(everything).not.toContain('응 안녕');
  expect(everything).not.toContain('좋은 아침');
});

test('existing persona: each differing field offers 기존 유지 / 새 내용 사용, defaulting to 기존 유지', async () => {
  const user = userEvent.setup();
  const existing = await s.createPersona({ ...sheet('길동이'), background: '', speechStyle: '존댓말' }, ['원래 말']);
  render(<ImportWizard llm={createFakeProvider([chunkReply, mergeReply])} target={existing} onDone={() => {}} now={NOW} />);
  await toPeriodStep(user);
  await user.click(screen.getByRole('button', { name: '추출 시작' }));
  await screen.findByLabelText('이름');
  // name, personality, speechStyle differ and are non-empty → a choice each; relation is identical; background was empty
  expect(screen.getAllByLabelText('기존 유지')).toHaveLength(3);
  screen.getAllByLabelText('기존 유지').forEach((r) => expect(r).toBeChecked());
  expect(screen.getByLabelText('이름')).toHaveValue('길동이');
  expect(screen.getByLabelText('배경 설정')).toHaveValue('서울');
  await user.click(screen.getAllByLabelText('새 내용 사용')[1]);
  expect(screen.getByLabelText('성격')).toHaveValue('장난기 많음');
  await user.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(async () => expect((await s.getActivePersona())!.personality).toBe('장난기 많음'));
  const p = (await s.getActivePersona())!;
  expect(p.id).toBe(existing.id);
  expect(p).toMatchObject({ name: '길동이', speechStyle: '존댓말', background: '서울' });
  expect(p.speechSamples).toEqual(['안녕', '원래 말']);
  expect(await s.db.personas.count()).toBe(1);
});

test('shows how many chunks were skipped', async () => {
  const user = userEvent.setup();
  const lines = Math.ceil((CHUNK_CHARS * 1.5) / 120);
  render(<ImportWizard llm={createFakeProvider(['읽을 수 없음', chunkReply, mergeReply])} target={null} onDone={() => {}} now={NOW} />);
  await toPeriodStep(user, bigExport(lines));
  await user.click(screen.getByRole('button', { name: '추출 시작' }));
  expect(await screen.findByText('1개 구간을 읽지 못해 건너뛰었습니다')).toBeInTheDocument();
});

test('after the first successful import shows the backup reminder once', async () => {
  const user = userEvent.setup();
  async function runOnce() {
    const onDone = vi.fn();
    const view = render(<ImportWizard llm={createFakeProvider([chunkReply, mergeReply])} target={null} onDone={onDone} now={NOW} />);
    await toPeriodStep(user);
    await user.click(screen.getByRole('button', { name: '추출 시작' }));
    await user.click(await screen.findByRole('button', { name: '저장' }));
    return { onDone, view };
  }
  const first = await runOnce();
  expect(await screen.findByText(/설정에서 백업을 내보내 두세요/)).toBeInTheDocument();
  expect(first.onDone).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '확인' }));
  expect(first.onDone).toHaveBeenCalled();
  first.view.unmount();
  const second = await runOnce();
  await waitFor(() => expect(second.onDone).toHaveBeenCalled());
  expect(screen.queryByText(/설정에서 백업을 내보내 두세요/)).not.toBeInTheDocument();
});
