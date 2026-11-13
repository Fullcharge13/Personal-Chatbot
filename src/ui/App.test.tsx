import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import * as s from '../db/store';

beforeEach(() => s.wipeAll());

test('four tabs render and switch screens', async () => {
  const user = userEvent.setup();
  render(<App />);
  const tabs = await screen.findAllByRole('tab');
  expect(tabs.map((t) => t.textContent)).toEqual(['대화', '인물', '내 정보', '설정']);
  expect(screen.getByRole('tab', { name: '대화' })).toHaveAttribute('aria-selected', 'true');
  await user.click(screen.getByRole('tab', { name: '설정' }));
  expect(await screen.findByLabelText('API 키')).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: '내 정보' }));
  expect(await screen.findByLabelText('취미')).toBeInTheDocument();
});

test('llmFactory is called only when an api key exists, with the saved settings', async () => {
  const factory = vi.fn();
  const { unmount } = render(<App llmFactory={factory} />);
  await screen.findAllByRole('tab');
  expect(factory).not.toHaveBeenCalled();
  unmount();
  await s.saveSettings({ apiKey: 'k', provider: 'anthropic', model: 'm' });
  render(<App llmFactory={factory} />);
  await vi.waitFor(() => expect(factory).toHaveBeenCalledWith({ apiKey: 'k', provider: 'anthropic', model: 'm' }));
});

test('tabs are locked while a chat import is in progress', async () => {
  const user = userEvent.setup();
  await s.saveSettings({ apiKey: 'k', provider: 'anthropic', model: 'm' });
  const never = { complete: () => new Promise<string>(() => {}), stream: async () => '' };
  render(<App llmFactory={() => never} />);
  await user.click(await screen.findByRole('tab', { name: '인물' }));
  await user.click(await screen.findByRole('button', { name: '대화 파일 가져오기' }));
  const text = '2024년 3월 1일 오후 2:15, 홍길동 : 안녕\n2024년 3월 1일 오후 2:16, 나 : 응';
  await user.upload(screen.getByLabelText('대화 내보내기 파일 (txt)'), new File([text], 'c.txt', { type: 'text/plain' }));
  await user.selectOptions(await screen.findByLabelText('인물이 될 사람'), '홍길동');
  await user.selectOptions(screen.getByLabelText('나'), '나');
  await user.click(screen.getByRole('button', { name: '다음' }));
  expect(screen.getByRole('tab', { name: '대화' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: '추출 시작' }));
  await screen.findByText('0 / 1 구간');
  for (const name of ['대화', '내 정보', '설정']) expect(screen.getByRole('tab', { name })).toBeDisabled();
  expect(screen.getByText('대화 파일을 가져오는 동안에는 다른 탭으로 갈 수 없습니다')).toBeInTheDocument();
});

test('asks the browser to keep the stored data', async () => {
  const persist = vi.fn(async () => true);
  Object.defineProperty(navigator, 'storage', { value: { persist }, configurable: true });
  render(<App />);
  await screen.findAllByRole('tab');
  expect(persist).toHaveBeenCalledTimes(1);
});
