import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatScreen } from './ChatScreen';
import * as s from '../db/store';
import { createFakeProvider } from '../llm/fake';
import { LlmError, type LlmProvider } from '../llm/provider';
import { mem, sheet } from '../test-helpers';

const HOUR = 3_600_000;
const NOW = new Date(2026, 10, 13, 21, 30).getTime();
const now = () => NOW;
const consolidated = JSON.stringify({ summary: '면접 결과를 기다리는 중', memories: [], threads: ['면접 결과'] });

let pid: string;
beforeEach(async () => {
  await s.wipeAll();
  pid = (await s.createPersona(sheet('지수'), ['헐 대박'])).id;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

/** A recent, already-answered exchange so that no opener is due. */
async function seedRecent() {
  const a = await s.addMessage({ personaId: pid, sender: 'user', text: '안녕', at: NOW - 10 * 60_000 });
  const b = await s.addMessage({ personaId: pid, sender: 'persona', text: '응 안녕', at: NOW - 9 * 60_000 });
  await s.markConsolidated([a.id, b.id]);
}
async function send(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByLabelText('메시지'), text);
  await user.click(screen.getByRole('button', { name: '보내기' }));
}

test('no persona → points to the persona tab', async () => {
  await s.wipeAll();
  const onGoTo = vi.fn();
  render(<ChatScreen llm={createFakeProvider([])} now={now} onGoTo={onGoTo} />);
  expect(await screen.findByText('인물 탭에서 인물을 먼저 만들어주세요')).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: '인물 만들러 가기' }));
  expect(onGoTo).toHaveBeenCalledWith('persona');
});

test('no api key → hint shown and input disabled; stored messages still visible', async () => {
  await seedRecent();
  render(<ChatScreen llm={null} now={now} />);
  expect(await screen.findByText('설정에서 API 키를 넣어주세요')).toBeInTheDocument();
  expect(screen.getByLabelText('메시지')).toBeDisabled();
  expect(screen.getByText('응 안녕')).toBeInTheDocument();
});

test('header shows the persona name', async () => {
  await seedRecent();
  render(<ChatScreen llm={createFakeProvider([])} now={now} />);
  expect(await screen.findByRole('heading', { name: '지수' })).toBeInTheDocument();
});

test('on mount with a 2-hour gap: consolidates, then shows the opener as a persona bubble', async () => {
  await s.addMessage({ personaId: pid, sender: 'user', text: '금요일에 면접 결과 나와', at: NOW - 2 * HOUR });
  const fake = createFakeProvider([consolidated, '면접 결과 나왔어?']);
  render(<ChatScreen llm={fake} now={now} />);
  expect(await screen.findByText('면접 결과 나왔어?')).toBeInTheDocument();
  expect(fake.calls).toHaveLength(2);
  expect(fake.calls[1].messages[0].content).toContain('면접 결과');
  expect((await s.getSummary(pid))!.text).toBe('면접 결과를 기다리는 중');
  expect((await s.listMessages(pid)).map((m) => m.sender)).toEqual(['user', 'persona']);
});

test('on mount under StrictMode the opener appears exactly once', async () => {
  const fake = createFakeProvider(['안녕, 뭐해?', '또 안녕']);
  render(
    <StrictMode>
      <ChatScreen llm={fake} now={now} />
    </StrictMode>,
  );
  expect(await screen.findByText('안녕, 뭐해?')).toBeInTheDocument();
  await act(() => new Promise((r) => setTimeout(r, 50)));
  expect(screen.getAllByText('안녕, 뭐해?')).toHaveLength(1);
  expect(screen.queryByText('또 안녕')).not.toBeInTheDocument();
  expect((await s.listMessages(pid)).filter((m) => m.sender === 'persona')).toHaveLength(1);
});

test('on mount with a 10-minute gap: no opener, no llm call', async () => {
  await seedRecent();
  const fake = createFakeProvider([]);
  render(<ChatScreen llm={fake} now={now} />);
  await screen.findByText('응 안녕');
  await act(() => new Promise((r) => setTimeout(r, 30)));
  expect(fake.calls).toHaveLength(0);
});

test('sending: user bubble appears immediately, reply streams in, both are stored', async () => {
  await seedRecent();
  const user = userEvent.setup();
  let push!: (t: string) => void;
  let finish!: (t: string) => void;
  const llm: LlmProvider = {
    complete: async () => '',
    stream: (_req, onDelta) => {
      push = onDelta;
      return new Promise<string>((resolve) => (finish = resolve));
    },
  };
  render(<ChatScreen llm={llm} now={now} />);
  await screen.findByText('응 안녕');
  await send(user, '오늘 뭐했어?');
  expect(await screen.findByText('오늘 뭐했어?')).toBeInTheDocument();
  expect(screen.getByLabelText('메시지')).toHaveValue('');
  await waitFor(() => expect(push).toBeDefined());
  act(() => push('그냥 '));
  expect(await screen.findByText('그냥')).toBeInTheDocument();
  act(() => push('집에 있었어'));
  expect(await screen.findByText('그냥 집에 있었어')).toBeInTheDocument();
  await act(async () => finish('그냥 집에 있었어'));
  await waitFor(async () =>
    expect((await s.listMessages(pid)).map((m) => m.text)).toEqual(['안녕', '응 안녕', '오늘 뭐했어?', '그냥 집에 있었어']),
  );
  expect(screen.getAllByText('그냥 집에 있었어')).toHaveLength(1);
});

test('the request is built from persona, profile, summary, memories and recent messages', async () => {
  await seedRecent();
  await s.saveProfileEntry('hobby', '등산을 좋아함');
  await s.saveSummary(pid, '지난주에 이사했다');
  await s.addMemories(pid, [mem('같이 제주도 감', ['제주도'])]);
  const user = userEvent.setup();
  const fake = createFakeProvider(['응 기억나']);
  render(<ChatScreen llm={fake} now={now} />);
  await screen.findByText('응 안녕');
  await send(user, '제주도 기억나?');
  await screen.findByText('응 기억나');
  const req = fake.calls[0];
  for (const part of ['당신은 지수입니다', '헐 대박', '등산을 좋아함', '지난주에 이사했다', '같이 제주도 감', '2026년 11월 13일']) {
    expect(req.system).toContain(part);
  }
  expect(req.messages).toEqual([
    { role: 'user', content: '안녕' },
    { role: 'assistant', content: '응 안녕' },
    { role: 'user', content: '제주도 기억나?' },
  ]);
});

test('network error: user message kept and marked failed; "다시 보내기" resends and clears the mark', async () => {
  await seedRecent();
  const user = userEvent.setup();
  const fake = createFakeProvider([new LlmError('network', 'Failed to fetch'), '이제 됐다']);
  render(<ChatScreen llm={fake} now={now} />);
  await screen.findByText('응 안녕');
  await send(user, '들려?');
  const retry = await screen.findByRole('button', { name: '다시 보내기' });
  expect(screen.getByText('들려?')).toBeInTheDocument();
  expect(screen.getByText('전송하지 못했습니다. 연결을 확인해주세요')).toBeInTheDocument();
  expect((await s.listMessages(pid)).find((m) => m.text === '들려?')!.failed).toBe(true);
  await user.click(retry);
  // the streaming bubble is swapped for the stored one, so wait for the settled state
  await waitFor(() => expect(screen.queryByRole('button', { name: '보내기' })).toBeDisabled());
  await waitFor(async () => expect((await s.listMessages(pid)).at(-1)!.text).toBe('이제 됐다'));
  await waitFor(() => expect(screen.getByText('이제 됐다')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: '다시 보내기' })).not.toBeInTheDocument();
  expect((await s.listMessages(pid)).find((m) => m.text === '들려?')!.failed).toBe(false);
  expect(fake.calls[1].messages.at(-1)).toEqual({ role: 'user', content: '들려?' });
  expect(screen.getAllByText('들려?')).toHaveLength(1);
});

test('auth error shows "API 키를 확인해주세요" with a way to settings', async () => {
  await seedRecent();
  const user = userEvent.setup();
  const onGoTo = vi.fn();
  render(<ChatScreen llm={createFakeProvider([new LlmError('auth', 'invalid x-api-key')])} now={now} onGoTo={onGoTo} />);
  await screen.findByText('응 안녕');
  await send(user, '안녕');
  expect(await screen.findByText('API 키를 확인해주세요')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '설정으로 가기' }));
  expect(onGoTo).toHaveBeenCalledWith('settings');
});

test('quota error shows the provider message verbatim', async () => {
  await seedRecent();
  const user = userEvent.setup();
  render(<ChatScreen llm={createFakeProvider([new LlmError('quota', 'Your credit balance is too low')])} now={now} />);
  await screen.findByText('응 안녕');
  await send(user, '안녕');
  expect(await screen.findByText('Your credit balance is too low')).toBeInTheDocument();
});

test('a refusal reply is displayed as a normal persona bubble; llm called once', async () => {
  await seedRecent();
  const user = userEvent.setup();
  const fake = createFakeProvider(['그건 도와줄 수 없어.']);
  render(<ChatScreen llm={fake} now={now} />);
  await screen.findByText('응 안녕');
  await send(user, '부탁이 있어');
  const bubble = await screen.findByText('그건 도와줄 수 없어.');
  expect(bubble).toHaveClass('bubble', 'persona');
  expect(fake.calls).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '다시 보내기' })).not.toBeInTheDocument();
});

test('an empty reply marks the message failed instead of storing an empty bubble', async () => {
  await seedRecent();
  const user = userEvent.setup();
  render(<ChatScreen llm={createFakeProvider([''])} now={now} />);
  await screen.findByText('응 안녕');
  await send(user, '안녕?');
  expect(await screen.findByRole('button', { name: '다시 보내기' })).toBeInTheDocument();
  expect((await s.listMessages(pid)).filter((m) => m.sender === 'persona')).toHaveLength(1);
});

test('send is disabled while a reply is streaming; whitespace-only input is not sent', async () => {
  await seedRecent();
  const user = userEvent.setup();
  const llm: LlmProvider = { complete: async () => '', stream: () => new Promise<string>(() => {}) };
  const spy = vi.spyOn(llm, 'stream');
  render(<ChatScreen llm={llm} now={now} />);
  await screen.findByText('응 안녕');
  expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled();
  await user.type(screen.getByLabelText('메시지'), '   ');
  expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled();
  await send(user, '첫 번째');
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  await user.type(screen.getByLabelText('메시지'), '두 번째');
  expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled();
});

test('visibilitychange to hidden triggers consolidate', async () => {
  await seedRecent();
  const user = userEvent.setup();
  const fake = createFakeProvider(['응', consolidated]);
  render(<ChatScreen llm={fake} now={now} />);
  await screen.findByText('응 안녕');
  await send(user, '금요일에 면접 결과 나와');
  await screen.findByText('응');
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
  await waitFor(async () => expect((await s.getSummary(pid))?.text).toBe('면접 결과를 기다리는 중'));
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

test('consolidate failure shows nothing to the user', async () => {
  await s.addMessage({ personaId: pid, sender: 'user', text: '잘자', at: NOW - 10 * 60_000 });
  render(<ChatScreen llm={createFakeProvider([new LlmError('network', '정리 실패')])} now={now} />);
  await screen.findByText('잘자');
  await act(() => new Promise((r) => setTimeout(r, 30)));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText(/정리 실패/)).not.toBeInTheDocument();
});

test('a storage quota error shows the backup advice and keeps the typed text', async () => {
  await seedRecent();
  const user = userEvent.setup();
  render(<ChatScreen llm={createFakeProvider(['응'])} now={now} />);
  await screen.findByText('응 안녕');
  vi.spyOn(s.db.messages, 'add').mockRejectedValue(new DOMException('full', 'QuotaExceededError'));
  await send(user, '저장 안 되는 말');
  expect(await screen.findByText('저장 공간이 부족합니다. 설정에서 백업을 내보내주세요')).toBeInTheDocument();
  expect(screen.getByLabelText('메시지')).toHaveValue('저장 안 되는 말');
});
