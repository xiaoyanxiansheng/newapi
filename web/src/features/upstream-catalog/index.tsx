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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus, RefreshCw, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

import * as api from './api'
import { AccountEditor } from './components/account-editor'
import { BatchBrowserConnection } from './components/batch-browser-connection'
import { BrowserConnection } from './components/browser-connection'
import { KeyModelPanel } from './components/key-model-panel'
import { ManualKeyEditor } from './components/manual-key-editor'
import { ManualKeysPanel } from './components/manual-keys-panel'
import { RefreshBalancesButton } from './components/refresh-balances-button'
import { UpstreamAccountBalances } from './components/upstream-funds'
import { UpstreamKeyCard } from './components/upstream-key-card'
import { UpstreamLifecycleActions } from './components/upstream-lifecycle-actions'
import { translateUpstreamError } from './errors'
import type {
  AccountInput,
  BalanceRefreshResults,
  CatalogFilters,
} from './types'

export function UpstreamCatalog() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [mode, setMode] = useState('account')
  const [filters, setFilters] = useState<CatalogFilters>({
    listingStatus: 'all',
    onlyChanges: false,
  })
  const [connecting, setConnecting] = useState(false)
  const [refreshingBalances, setRefreshingBalances] = useState(false)
  const [batchConnecting, setBatchConnecting] = useState(false)
  const [balanceResults, setBalanceResults] = useState<BalanceRefreshResults>(
    {}
  )
  const [creationType, setCreationType] = useState('account')
  const accounts = useQuery({
    queryKey: ['upstream-accounts'],
    queryFn: api.getAccounts,
    retry: false,
  })
  const [accountId, setAccountId] = useState<number | null>(null)
  const currentId = accountId ?? accounts.data?.[0]?.id ?? null
  const detail = useQuery({
    queryKey: ['upstream-account', currentId],
    queryFn: () => api.getAccount(currentId ?? 0),
    enabled: currentId !== null && mode === 'account',
    retry: false,
    refetchInterval: 60_000,
  })
  const account = detail.data?.account
  const [editor, setEditor] = useState<null | undefined>(undefined)
  const [openKey, setOpenKey] = useState<number | null>(null)
  const action = useMutation({
    mutationFn: (operation: () => Promise<void>) => operation(),
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['upstream-accounts'] }),
        client.invalidateQueries({ queryKey: ['upstream-account'] }),
        client.invalidateQueries({ queryKey: ['upstream-source'] }),
        client.invalidateQueries({ queryKey: ['upstream-manual-keys'] }),
      ])
    },
  })
  const busy = action.isPending || refreshingBalances || batchConnecting
  const error = action.error instanceof Error ? action.error.message : null
  const pageError = error || account?.last_error
  const needsBrowserConnection =
    !!account &&
    !account.has_session &&
    (account.auth_type === 'browser' ||
      account.workflow === 'browser-auto-v1' ||
      !!account.discovery_mode)
  function saveAccount(input: AccountInput, existingId?: number): void {
    action.mutate(async () => {
      const saved = await api.saveAccount(input, existingId)
      // Close the editor once saved, even if loading its details needs a retry.
      setConnecting(false)
      setAccountId(saved.id)
      setMode('account')
      setEditor(undefined)
      setOpenKey(null)
      const updated = await api.getAccount(saved.id)
      client.setQueryData(['upstream-account', saved.id], updated)
      setConnecting(!updated.account.has_session)
    })
  }
  return (
    <>
      {accounts.data?.map((savedAccount) => (
        <BrowserConnection
          key={savedAccount.id}
          account={savedAccount.id === account?.id ? account : savedAccount}
          open={connecting && savedAccount.id === currentId}
          saving={busy}
          saveError={error}
          onSave={(input) => saveAccount(input, savedAccount.id)}
          onDisconnected={() => {
            if (savedAccount.id === currentId && !savedAccount.disabled) {
              setConnecting(true)
            }
          }}
          onClose={() => setConnecting(false)}
          onBalanceRead={async () => {
            await Promise.all([
              client.invalidateQueries({ queryKey: ['upstream-accounts'] }),
              client.invalidateQueries({
                queryKey: ['upstream-account', savedAccount.id],
              }),
            ])
          }}
          onConnected={async () => {
            action.reset()
            await Promise.all([
              client.invalidateQueries({ queryKey: ['upstream-accounts'] }),
              client.invalidateQueries({ queryKey: ['upstream-account'] }),
              client.invalidateQueries({ queryKey: ['upstream-source'] }),
            ])
            if (savedAccount.id === currentId) setConnecting(false)
          }}
        />
      ))}
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Upstream channels')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='mx-auto w-full max-w-7xl min-w-0 space-y-5'>
            <div className='hwjai-project-card flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5'>
              <div>
                <h2 className='text-xl font-semibold'>
                  {t('Your existing Keys. Your models. Your selling prices.')}
                </h2>
                <p className='text-muted-foreground mt-2 text-sm'>
                  {t(
                    'Read existing Keys from a website account, or enter an API address and Key yourself.'
                  )}
                </p>
              </div>
              <div className='flex flex-wrap gap-2'>
                <BatchBrowserConnection
                  accounts={accounts.data ?? []}
                  disabled={busy}
                  onPendingChange={setBatchConnecting}
                  onRefreshed={async (moneyOnly) => {
                    await Promise.all([
                      client.invalidateQueries({
                        queryKey: ['upstream-accounts'],
                      }),
                      client.invalidateQueries({
                        queryKey: ['upstream-account'],
                      }),
                      ...(!moneyOnly
                        ? [
                            client.invalidateQueries({
                              queryKey: ['upstream-source'],
                            }),
                          ]
                        : []),
                    ])
                  }}
                />
                <RefreshBalancesButton
                  accounts={accounts.data ?? []}
                  disabled={busy}
                  onResults={setBalanceResults}
                  onPendingChange={setRefreshingBalances}
                  onRefreshed={async () => {
                    await Promise.all([
                      client.invalidateQueries({
                        queryKey: ['upstream-accounts'],
                      }),
                      client.invalidateQueries({
                        queryKey: ['upstream-account'],
                      }),
                    ])
                  }}
                />
                <Button
                  disabled={busy}
                  onClick={() => {
                    action.reset()
                    setCreationType(mode)
                    setEditor(null)
                  }}
                >
                  <Plus aria-hidden='true' />
                  {t('Add upstream')}
                </Button>
              </div>
            </div>
            <Tabs
              value={mode}
              onValueChange={(value) => {
                if (typeof value === 'string') {
                  setMode(value)
                  action.reset()
                }
              }}
            >
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <TabsList
                  className='bg-primary/5 h-11 rounded-xl border p-1'
                  aria-label={t('Key source')}
                >
                  <TabsTrigger
                    className='data-active:bg-primary data-active:text-primary-foreground px-5'
                    value='account'
                  >
                    {t('Account Keys')}
                  </TabsTrigger>
                  <TabsTrigger
                    className='data-active:bg-primary data-active:text-primary-foreground px-5'
                    value='manual'
                  >
                    {t('Manual Keys')}
                  </TabsTrigger>
                </TabsList>
                <div className='flex flex-wrap items-center gap-4'>
                  <NativeSelect
                    aria-label={t('Listing status')}
                    value={filters.listingStatus}
                    onChange={(event) =>
                      setFilters((previous) => ({
                        ...previous,
                        listingStatus: event.target.value,
                      }))
                    }
                  >
                    <NativeSelectOption value='all'>
                      {t('All listing statuses')}
                    </NativeSelectOption>
                    <NativeSelectOption value='listed'>
                      {t('Listed')}
                    </NativeSelectOption>
                    <NativeSelectOption value='paused'>
                      {t('Listing paused')}
                    </NativeSelectOption>
                    <NativeSelectOption value='other'>
                      {t('Not listed')}
                    </NativeSelectOption>
                  </NativeSelect>
                  <label className='flex items-center gap-2 text-sm'>
                    <input
                      type='checkbox'
                      checked={filters.onlyChanges}
                      onChange={(event) =>
                        setFilters((previous) => ({
                          ...previous,
                          onlyChanges: event.target.checked,
                        }))
                      }
                    />
                    {t('Only changes')}
                  </label>
                </div>
              </div>
              <TabsContent value='manual'>
                <ManualKeysPanel filters={filters} />
              </TabsContent>
              <TabsContent value='account' className='space-y-5'>
                {accounts.data && accounts.data.length > 0 && (
                  <UpstreamAccountBalances
                    accounts={accounts.data}
                    selectedId={currentId}
                    busy={busy}
                    refreshResults={balanceResults}
                    onSelect={(id) => {
                      setAccountId(id)
                      setOpenKey(null)
                      action.reset()
                    }}
                  />
                )}
                {pageError &&
                  editor === undefined &&
                  !connecting &&
                  mode === 'account' && (
                    <p
                      role='alert'
                      className='bg-destructive/5 text-destructive rounded-xl p-3'
                    >
                      {translateUpstreamError(pageError, t)}
                    </p>
                  )}
                {accounts.isPending && <p role='status'>{t('Loading...')}</p>}
                {accounts.isError && (
                  <div role='alert'>
                    <p>
                      {t(
                        'Could not load upstream accounts. Retry to load the saved accounts.'
                      )}
                    </p>
                    <Button onClick={() => accounts.refetch()}>
                      {t('Retry')}
                    </Button>
                  </div>
                )}
                {accounts.data?.length === 0 && (
                  <div className='bg-muted/20 rounded-2xl border p-8 text-center'>
                    <KeyRound
                      className='text-primary mx-auto mb-3 size-8'
                      aria-hidden='true'
                    />
                    <p>
                      {t(
                        'Add your website account to read Keys you have already created.'
                      )}
                    </p>
                  </div>
                )}
                {currentId !== null && (
                  <>
                    <div className='flex flex-wrap items-center justify-between gap-3'>
                      <NativeSelect
                        aria-label={t('Upstream account')}
                        value={currentId}
                        disabled={busy}
                        onChange={(event) => {
                          setAccountId(Number(event.target.value))
                          setOpenKey(null)
                          action.reset()
                        }}
                      >
                        {accounts.data?.map((item) => (
                          <NativeSelectOption key={item.id} value={item.id}>
                            {item.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      <div className='flex flex-wrap gap-2'>
                        {account && (
                          <UpstreamLifecycleActions
                            kind='account'
                            channel={account}
                            busy={busy}
                            onDeleted={() => {
                              setAccountId(null)
                              setOpenKey(null)
                              setConnecting(false)
                            }}
                          />
                        )}
                        <Button
                          variant='outline'
                          disabled={busy || !account}
                          onClick={() => {
                            action.reset()
                            setConnecting(true)
                          }}
                        >
                          <Settings2 aria-hidden='true' />
                          {t('Account settings')}
                        </Button>
                        <Button
                          disabled={busy || !account || needsBrowserConnection}
                          onClick={() =>
                            action.mutate(async () => {
                              await api.refreshAccount(currentId)
                              setOpenKey(null)
                            })
                          }
                        >
                          <RefreshCw
                            aria-hidden='true'
                            className={busy ? 'animate-spin' : ''}
                          />
                          {t('Read existing Keys')}
                        </Button>
                      </div>
                    </div>
                    {detail.isPending && <p role='status'>{t('Loading...')}</p>}
                    {detail.isError && (
                      <div role='alert'>
                        <p>
                          {t(
                            'Could not load the upstream account. Retry to see its saved Keys.'
                          )}
                        </p>
                        <Button onClick={() => detail.refetch()}>
                          {t('Retry')}
                        </Button>
                      </div>
                    )}
                    {account && (
                      <>
                        <div className='text-muted-foreground flex flex-wrap gap-3 text-xs'>
                          <span
                            className={
                              account.disabled
                                ? 'text-destructive font-semibold'
                                : 'font-semibold text-emerald-600'
                            }
                          >
                            {t(
                              account.disabled
                                ? 'Channel disabled'
                                : 'Channel enabled'
                            )}
                          </span>
                          <span>{account.website}</span>
                          <span>{account.username}</span>
                          <span>
                            {t('Last refresh')}:{' '}
                            {account.last_sync
                              ? new Date(
                                  account.last_sync * 1000
                                ).toLocaleString()
                              : t('Not read yet')}
                          </span>
                          <span>
                            {t('Default markup multiplier')}: {account.markup}x
                          </span>
                          {account.discovery_mode && (
                            <span>
                              {t('Automatic connection')}:{' '}
                              {t(
                                account.discovery_mode === 'page'
                                  ? 'Key page reading'
                                  : 'API Key reading'
                              )}
                            </span>
                          )}
                        </div>
                        {account.disabled && (
                          <p
                            role='status'
                            className='rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700'
                          >
                            {t(
                              'This channel is disabled. All its models are paused. Enable the channel, then resume the models you want to publish.'
                            )}
                          </p>
                        )}
                        {!account.has_session && !needsBrowserConnection && (
                          <p
                            role='status'
                            className='bg-muted/40 rounded-lg p-3 text-sm'
                          >
                            {t(
                              'Authorize this Key page to detect its reading method automatically.'
                            )}
                          </p>
                        )}
                        {needsBrowserConnection && (
                          <div
                            role='status'
                            className='bg-primary/5 rounded-xl border p-4 text-sm'
                          >
                            <p>
                              {t(
                                'Open the upstream website and click the connection bookmark to read existing Keys. Your browser login is reused; sign in only if the website asks.'
                              )}
                            </p>
                            <Button
                              variant='outline'
                              className='mt-2'
                              disabled={busy}
                              onClick={() => setConnecting(true)}
                            >
                              {t('Open upstream website')}
                            </Button>
                          </div>
                        )}
                        {detail.data?.keys.length === 0 &&
                          !needsBrowserConnection && (
                            <p className='text-muted-foreground rounded-xl border p-6 text-sm'>
                              {t(
                                'Read existing Keys to load this account. Keys are never created automatically.'
                              )}
                            </p>
                          )}
                        <div className='space-y-3'>
                          {detail.data?.keys.map((key) => {
                            const expanded = openKey === key.id
                            const available =
                              !account.disabled &&
                              !key.disabled &&
                              !key.key_missing &&
                              key.key_status === 1 &&
                              !key.key_issue &&
                              (!key.key_expires_at ||
                                key.key_expires_at < 0 ||
                                key.key_expires_at > Date.now() / 1000)
                            return (
                              <UpstreamKeyCard
                                key={key.id}
                                source={key}
                                expanded={expanded}
                                busy={busy}
                                available={available}
                                onExpand={() => {
                                  if (expanded) {
                                    setOpenKey(null)
                                    return
                                  }
                                  setOpenKey(key.id)
                                  if (
                                    available &&
                                    !needsBrowserConnection &&
                                    (key.latest_time === 0 || !!key.last_error)
                                  ) {
                                    action.mutate(() =>
                                      api.refreshSource(key.id)
                                    )
                                  }
                                }}
                              >
                                <KeyModelPanel
                                  sourceId={key.id}
                                  filters={filters}
                                  refreshing={busy}
                                />
                              </UpstreamKeyCard>
                            )
                          })}
                        </div>
                      </>
                    )}
                  </>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
      <Dialog
        open={editor !== undefined}
        onOpenChange={(open) => {
          if (!open && !busy) setEditor(undefined)
        }}
      >
        <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{t('Add upstream')}</DialogTitle>
          </DialogHeader>
          {editor === null && (
            <Tabs
              value={creationType}
              onValueChange={(value) => {
                if (!busy && typeof value === 'string') {
                  setCreationType(value)
                  action.reset()
                }
              }}
            >
              <TabsList
                className='bg-primary/5 h-11 rounded-xl border p-1'
                aria-label={t('Add Key using')}
              >
                <TabsTrigger
                  className='data-active:bg-primary data-active:text-primary-foreground px-4'
                  disabled={busy}
                  value='account'
                >
                  {t('Read from upstream account')}
                </TabsTrigger>
                <TabsTrigger
                  className='data-active:bg-primary data-active:text-primary-foreground px-4'
                  disabled={busy}
                  value='manual'
                >
                  {t('Enter address and Key')}
                </TabsTrigger>
              </TabsList>
              <TabsContent value='account'>
                <AccountEditor
                  busy={busy}
                  onCancel={() => setEditor(undefined)}
                  onSave={saveAccount}
                />
              </TabsContent>
              <TabsContent value='manual'>
                <ManualKeyEditor
                  busy={busy}
                  onCancel={() => setEditor(undefined)}
                  onSave={(input) =>
                    action.mutate(async () => {
                      await api.saveManualKey(input)
                      setEditor(undefined)
                      setMode('manual')
                    })
                  }
                />
              </TabsContent>
            </Tabs>
          )}
          {error && (
            <p role='alert' className='text-destructive text-sm'>
              {translateUpstreamError(error, t)}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
