import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileScreen } from './ProfileScreen';
import * as s from '../db/store';

beforeEach(() => s.wipeAll());

test('four labeled textareas load and save', async () => {
  const user = userEvent.setup();
  await s.saveProfileEntry('hobby', '등산');
  render(<ProfileScreen />);
  expect(await screen.findByLabelText('취미')).toHaveValue('등산');
  for (const label of ['기본 정보', '이력서', '과거 이야기']) expect(screen.getByLabelText(label)).toHaveValue('');
  await user.type(screen.getByLabelText('기본 정보'), '이름은 민수');
  await user.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(async () => expect((await s.getProfile())[0].text).toBe('이름은 민수'));
  expect(screen.getByText('저장했습니다')).toBeInTheDocument();
});

test('attaching a .txt file appends its text to that entry', async () => {
  const user = userEvent.setup();
  await s.saveProfileEntry('resume', '기존 내용');
  render(<ProfileScreen />);
  await screen.findByLabelText('이력서');
  await user.upload(screen.getByLabelText('이력서 txt 첨부'), new File(['경력 5년'], 'resume.txt', { type: 'text/plain' }));
  await waitFor(() => expect(screen.getByLabelText('이력서')).toHaveValue('기존 내용\n경력 5년'));
});

test('attaching a non-txt file shows an error and changes nothing', async () => {
  const user = userEvent.setup({ applyAccept: false });
  render(<ProfileScreen />);
  await screen.findByLabelText('이력서');
  await user.upload(screen.getByLabelText('이력서 txt 첨부'), new File(['%PDF'], 'resume.pdf', { type: 'application/pdf' }));
  expect(await screen.findByText('txt 파일만 넣을 수 있습니다')).toBeInTheDocument();
  expect(screen.getByLabelText('이력서')).toHaveValue('');
});
