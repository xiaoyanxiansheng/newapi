/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import { AccountEditor } from '../components/account-editor'
import {
  UpstreamAccountBalances,
  UpstreamMoneyValue,
} from '../components/upstream-funds'
import type { UpstreamAccount } from '../types'

const account: UpstreamAccount = {
  id: 1,
  name: 'site',
  website: 'https://example.com',
  key_page_url: 'https://example.com/keys',
  username: '',
  markup: '1.1',
  revision: 2,
  last_sync: 100,
  last_error: '',
  workflow: 'browser-auto-v1',
  balance_cny: '250.00',
  balance_read_time: 100,
}

test('the funds display preserves upstream zero and unavailable observations as different values', () => {
  render(
    <>
      <UpstreamMoneyValue label='Key spent' value='0.00' readTime={100} />
      <UpstreamMoneyValue label='Website balance' />
    </>
  )
  expect(
    within(screen.getByRole('group', { name: 'Key spent' })).getByText('¥0.00')
  ).toBeInTheDocument()
  expect(
    within(screen.getByRole('group', { name: 'Website balance' })).getByText(
      '—'
    )
  ).toBeInTheDocument()
})

test.each([
  ['0.5418974', '¥0.54'],
  ['4.4581026', '¥4.46'],
  ['-0.005', '¥-0.01'],
  ['0.00001', '¥0.00'],
  ['9999999999999999.995', '¥10000000000000000.00'],
])(
  'upstream amount %s displays two decimals while keeping its complete observation',
  (value, displayed) => {
    render(<UpstreamMoneyValue label='Key spent' value={value} />)
    expect(screen.getByText(displayed)).toHaveAttribute('title', `¥${value}`)
  }
)

test('each website balance remains separately visible and its card selects that account', async () => {
  const onSelect = vi.fn()
  render(
    <UpstreamAccountBalances
      accounts={[
        account,
        { ...account, id: 2, name: 'another', balance_cny: '0.00' },
      ]}
      selectedId={1}
      busy={false}
      onSelect={onSelect}
    />
  )
  const selected = screen.getByRole('button', {
    name: 'Website balance for site',
  })
  expect(selected).toHaveAttribute('aria-pressed', 'true')
  expect(within(selected).getByText('¥250.00')).toBeInTheDocument()
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Website balance for another' }))
  expect(onSelect).toHaveBeenCalledWith(2)
})

test('website balance cards stay disabled during an update and do not switch the current account', async () => {
  const onSelect = vi.fn()
  render(
    <UpstreamAccountBalances
      accounts={[account]}
      selectedId={1}
      busy
      onSelect={onSelect}
    />
  )
  const button = screen.getByRole('button', {
    name: 'Website balance for site',
  })
  expect(button).toBeDisabled()
  expect(button).toHaveAttribute('aria-pressed', 'true')
  await userEvent.setup().click(button)
  expect(onSelect).not.toHaveBeenCalled()
})

test('account settings save and open an optional same-site balance URL without changing the Key page', async () => {
  const onSave = vi.fn()
  const onOpen = vi.fn()
  render(
    <AccountEditor
      account={account}
      busy={false}
      onSave={onSave}
      onCancel={vi.fn()}
      connection={{ onOpen }}
    />
  )
  const user = userEvent.setup()
  await user.type(
    screen.getByLabelText('Balance page (optional)'),
    'https://example.com/wallet'
  )
  await user.click(screen.getByRole('button', { name: 'Open balance page' }))
  expect(onOpen).toHaveBeenCalledWith('https://example.com/wallet', 'balance')
  await user.click(
    screen.getByRole('button', { name: 'Save upstream account' })
  )
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      balance_page_url: 'https://example.com/wallet',
      key_page_url: 'https://example.com/keys',
    })
  )
})
