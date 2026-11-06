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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import { AccountEditor } from '../components/account-editor'
import type { UpstreamAccount } from '../types'

const account: UpstreamAccount = {
  id: 1,
  name: 'xxapi',
  website: 'https://xxapi.info',
  username: 'owner',
  markup: '1.1',
  revision: 2,
  last_sync: 100,
  last_error: '',
  workflow: 'xxapi-existing-keys-v1',
  auth_type: 'password',
}

test('existing account settings include the saved website page and submit without replacing the saved identity', async () => {
  const onSave = vi.fn()
  render(
    <AccountEditor
      account={account}
      busy={false}
      onSave={onSave}
      onCancel={vi.fn()}
    />
  )
  expect(screen.getAllByRole('textbox')).toHaveLength(4)
  expect(screen.queryByLabelText('Website address')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Key management page')).toHaveValue(
    'https://xxapi.info/keys'
  )
  expect(
    screen.queryByLabelText('Website login username')
  ).not.toBeInTheDocument()
  expect(
    screen.queryByLabelText('Website login password')
  ).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Login method')).not.toBeInTheDocument()
  const user = userEvent.setup()
  await user.clear(screen.getByLabelText('Website name'))
  await user.type(screen.getByLabelText('Website name'), 'Renamed site')
  await user.click(
    screen.getByRole('button', { name: 'Save upstream account' })
  )
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({
      name: 'Renamed site',
      markup: '1.1',
      auth_type: 'browser',
      revision: 2,
      key_page_url: 'https://xxapi.info/keys',
    })
  )
})

test('creating an account needs only the Key page once and sends browser authorization without credentials', async () => {
  const onSave = vi.fn()
  render(<AccountEditor busy={false} onSave={onSave} onCancel={vi.fn()} />)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Website name'), 'xxapi')
  await user.type(
    screen.getByLabelText('Key management page'),
    'https://xxapi.info/console/token#keys'
  )
  expect(screen.getAllByRole('textbox')).toHaveLength(3)
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: 'Save upstream account' })
  )
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({
      name: 'xxapi',
      key_page_url: 'https://xxapi.info/console/token#keys',
      markup: '1.1',
      auth_type: 'browser',
      revision: undefined,
    })
  )
})

test.each([
  '',
  'http://xxapi.info/keys',
  'https:xxapi.info/keys',
  'https://owner:password@xxapi.info/keys',
  'javascript:alert(1)',
])('an invalid Key page %s blocks account creation', async (page) => {
  const onSave = vi.fn()
  render(<AccountEditor busy={false} onSave={onSave} onCancel={vi.fn()} />)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Website name'), 'site')
  if (page) await user.type(screen.getByLabelText('Key management page'), page)
  await user.click(
    screen.getByRole('button', { name: 'Save upstream account' })
  )
  await waitFor(() =>
    expect(screen.getByLabelText('Key management page')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
  )
  expect(onSave).not.toHaveBeenCalled()
})

test('while saving an account all displayed fields and actions are disabled', () => {
  render(<AccountEditor busy onSave={vi.fn()} onCancel={vi.fn()} />)
  for (const input of screen.getAllByRole('textbox')) {
    expect(input).toBeDisabled()
  }
  expect(
    screen.getByRole('button', { name: 'Save upstream account' })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
})
