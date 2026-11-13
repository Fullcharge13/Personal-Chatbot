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
