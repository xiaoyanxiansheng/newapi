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
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { accountSchema, type AccountForm } from '../lib/account-schema'
import type { AccountInput, UpstreamAccount } from '../types'

export function AccountEditor(props: {
  account?: UpstreamAccount
  busy: boolean
  onSave: (input: AccountInput) => void
  onCancel: () => void
  connection?: {
    bookmark?: string
    onOpen: (page: string, kind?: 'balance') => void
  }
}) {
  const { t } = useTranslation()
  let keyPage = ''
  if (props.account) {
    keyPage = new URL('/keys', props.account.website).href
    try {
      const savedPage = new URL(props.account.key_page_url || keyPage)
      if (
        savedPage.origin === new URL(props.account.website).origin &&
        !savedPage.username &&
        !savedPage.password
      ) {
        keyPage = savedPage.href
      }
    } catch {
      // Older accounts may not have a valid saved Key page.
    }
  }
  const form = useForm<AccountForm>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      name: props.account?.name ?? '',
      markup: props.account?.markup ?? '1.1',
      key_page_url: keyPage,
      balance_page_url: props.account?.balance_page_url ?? '',
    },
  })
  const fields = [
    ['name', 'Website name'],
    ['markup', 'Default markup multiplier'],
    ['key_page_url', 'Key management page'],
  ] as const
  function validatePage(): string | null {
    const page = form.getValues('key_page_url')?.trim() || ''
    if (!accountSchema.shape.key_page_url.safeParse(page).success) {
      form.setError('key_page_url', { message: 'Enter a valid value' })
      return null
    }
    if (
      props.account &&
      new URL(page).origin !== new URL(props.account.website).origin
    ) {
      form.setError('key_page_url', {
        message: 'Add a separate upstream account to use a different website.',
      })
      return null
    }
    form.clearErrors('key_page_url')
    return page
  }
  return (
    <form
      className='space-y-5'
      onSubmit={form.handleSubmit((input) => {
        const page = validatePage()
        if (!page) return
        const saved: AccountInput = {
          name: input.name,
          markup: input.markup,
          auth_type: 'browser',
          revision: props.account?.revision,
          key_page_url: page,
        }
        const balancePage = input.balance_page_url?.trim() || ''
        if (
          balancePage &&
          new URL(balancePage).origin !== new URL(page).origin
        ) {
          form.setError('balance_page_url', { message: 'Enter a valid value' })
          return
        }
        if (balancePage || props.account?.balance_page_url) {
          saved.balance_page_url = balancePage
        }
        props.onSave(saved)
      })}
    >
      <div className='grid gap-4 sm:grid-cols-2'>
        {fields.map(([key, label]) => (
          <div
            key={key}
            className={
              key === 'key_page_url' ? 'space-y-2 sm:col-span-2' : 'space-y-2'
            }
          >
            <Label htmlFor={`account-${key}`}>{t(label)}</Label>
            <div className='flex min-w-0 flex-col gap-2 sm:flex-row'>
              <Input
                className='min-w-0 flex-1'
                id={`account-${key}`}
                type='text'
                autoComplete='off'
                disabled={props.busy}
                {...form.register(key)}
                aria-invalid={!!form.formState.errors[key]}
              />
              {key === 'key_page_url' && props.connection && (
                <Button
                  type='button'
                  variant='outline'
                  disabled={props.busy}
                  onClick={() => {
                    const page = validatePage()
                    if (page) props.connection?.onOpen(page)
                  }}
                >
                  {t('Open upstream website')}
                </Button>
              )}
            </div>
            {form.formState.errors[key] && (
              <p className='text-destructive text-xs'>
                {t(
                  form.formState.errors[key]?.message ===
                    'Add a separate upstream account to use a different website.'
                    ? 'Add a separate upstream account to use a different website.'
                    : 'Enter a valid value'
                )}
              </p>
            )}
            {key === 'key_page_url' && !props.account && (
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Paste the Key management page once. The website address is detected automatically.'
                )}
              </p>
            )}
          </div>
        ))}
      </div>
      {props.account && (
        <div className='space-y-2'>
          <Label htmlFor='account-balance-page'>
            {t('Balance page (optional)')}
          </Label>
          <div className='flex min-w-0 flex-col gap-2 sm:flex-row'>
            <Input
              id='account-balance-page'
              className='min-w-0 flex-1'
              autoComplete='off'
              disabled={props.busy}
              aria-invalid={!!form.formState.errors.balance_page_url}
              {...form.register('balance_page_url')}
            />
            {props.connection && (
              <Button
                type='button'
                variant='outline'
                disabled={props.busy}
                onClick={() => {
                  const page = form.getValues('balance_page_url')?.trim() || ''
                  const key = validatePage()
                  if (
                    !key ||
                    !page ||
                    !accountSchema.shape.balance_page_url.safeParse(page)
                      .success ||
                    new URL(page).origin !== new URL(key).origin
                  ) {
                    form.setError('balance_page_url', {
                      message: 'Enter a valid value',
                    })
                    return
                  }
                  form.clearErrors('balance_page_url')
                  props.connection?.onOpen(page, 'balance')
                }}
              >
                {t('Open balance page')}
              </Button>
            )}
          </div>
          {form.formState.errors.balance_page_url && (
            <p className='text-destructive text-xs'>
              {t('Enter a valid value')}
            </p>
          )}
          <p className='text-muted-foreground text-xs'>
            {t(
              'Balance is detected automatically. If needed, save its page URL, open that page and click the same authorization bookmark.'
            )}
          </p>
        </div>
      )}
      {props.connection?.bookmark && (
        <div className='bg-primary/5 space-y-3 rounded-xl border p-4 text-sm'>
          <p>
            {t(
              'Drag this bookmark to your bookmarks bar. Open the upstream website, sign in, then click the bookmark on its Key page.'
            )}
          </p>
          <a
            ref={(element) => {
              if (element && props.connection?.bookmark) {
                element.setAttribute('href', props.connection.bookmark)
              }
            }}
            draggable
            className='bg-primary/10 text-primary block rounded-lg border px-4 py-2 text-center font-semibold'
            onClick={(event) => event.preventDefault()}
          >
            {t('Connect to hwjai')}
          </a>
          <p className='text-muted-foreground text-xs'>
            {t(
              'This bookmark works across upstream websites. Replace an older site-specific bookmark once.'
            )}
          </p>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Keep hwjai and the upstream window open for automatic renewal. Existing Keys are only read.'
            )}
          </p>
        </div>
      )}
      {!props.connection?.bookmark && !props.account && (
        <p className='bg-primary/5 text-muted-foreground rounded-xl p-3 text-sm'>
          {t(
            'Sign in on the upstream website, then authorize the connection to read your existing Keys. Choose your login method on that website.'
          )}
        </p>
      )}
      <div className='flex justify-end gap-2'>
        <Button
          type='button'
          variant='outline'
          disabled={props.busy}
          onClick={props.onCancel}
        >
          {t('Cancel')}
        </Button>
        <Button type='submit' disabled={props.busy}>
          {t('Save upstream account')}
        </Button>
      </div>
    </form>
  )
}
