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
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { getRouteQuotes } from '../api'
import { PriceBreakdown } from './price-breakdown'

export function RouteQuotesPanel(props: {
  sourceId: number
  revision: number
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [model, setModel] = useState('')
  const quotes = useQuery({
    queryKey: ['upstream-route-quotes', props.sourceId, props.revision],
    queryFn: () => getRouteQuotes(props.sourceId),
    enabled: open,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  const keyword = search.trim().toLowerCase()
  const models = (quotes.data?.models ?? [])
    .map((entry) => ({
      ...entry,
      routes: entry.routes.filter(
        (route) =>
          entry.model.toLowerCase().includes(keyword) ||
          route.access_model.toLowerCase().includes(keyword) ||
          route.channel_no?.toLowerCase().includes(keyword)
      ),
    }))
    .filter((entry) => entry.routes.length > 0)
  const current = models.find((entry) => entry.model === model) ?? models[0]
  const regionId = `route-quotes-${props.sourceId}`

  return (
    <section className='w-full max-w-full min-w-0 rounded-xl border'>
      <Button
        variant='ghost'
        className='h-auto w-full justify-start whitespace-normal'
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((previous) => !previous)}
      >
        {t('Route quotes by model (read-only)')}
      </Button>
      {open && (
        <div
          id={regionId}
          role='region'
          aria-label={t('Upstream route quotes')}
          className='max-w-full min-w-0 space-y-3 border-t p-3 sm:p-4'
        >
          <p className='text-muted-foreground text-xs'>
            {t(
              'Reference quotes only. Key route bindings and invocation permissions have not been verified. Reading does not publish models or change prices.'
            )}
          </p>
          {quotes.isPending && <p role='status'>{t('Loading...')}</p>}
          {quotes.isError && (
            <div role='alert' className='space-y-2'>
              <p>
                {t('Could not read route quotes. Retry the read-only request.')}
              </p>
              <Button variant='outline' onClick={() => quotes.refetch()}>
                {t('Retry')}
              </Button>
            </div>
          )}
          {quotes.data && (
            <>
              <div className='text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs'>
                <span>
                  {t('{{models}} models · {{routes}} route quotes', {
                    models: quotes.data.model_count,
                    routes: quotes.data.route_count,
                  })}
                  {' · '}
                  {t(
                    quotes.data.origin === 'public_marketplace'
                      ? 'Live upstream marketplace'
                      : 'Saved authorization pricing'
                  )}
                </span>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={quotes.isFetching}
                  onClick={() => quotes.refetch()}
                >
                  {t('Read route quotes again')}
                </Button>
              </div>
              <p className='text-muted-foreground text-xs'>
                {t('Quote read time')}:{' '}
                {new Date(quotes.data.quote_time * 1000).toLocaleString()}
              </p>
              {quotes.data.snapshot_stale && (
                <p className='text-xs text-amber-700 dark:text-amber-300'>
                  {t(
                    'Model permissions come from an older authorization snapshot; these quotes do not confirm current Key access.'
                  )}
                </p>
              )}
              {quotes.data.issues.includes(
                'marketplace_unavailable_using_snapshot'
              ) && (
                <p className='text-xs text-amber-700 dark:text-amber-300'>
                  {t(
                    'The public marketplace could not be read. Showing saved pricing coefficients; missing model multipliers remain unconfirmed.'
                  )}
                </p>
              )}
              <div className='grid min-w-0 gap-2 sm:grid-cols-2'>
                <Input
                  aria-label={t('Search route model, access name or ID')}
                  placeholder={t('Search route model, access name or ID')}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <select
                  aria-label={t('Choose quote model')}
                  className='bg-background h-9 w-full min-w-0 rounded-md border px-3 text-sm'
                  value={current?.model ?? ''}
                  onChange={(event) => setModel(event.target.value)}
                >
                  {models.map((entry) => (
                    <option key={entry.model} value={entry.model}>
                      {entry.model} ({entry.routes.length})
                    </option>
                  ))}
                </select>
              </div>
              {!current && (
                <p>{t('No route quotes match this Key and search.')}</p>
              )}
              {current && (
                <div className='space-y-3'>
                  <h4 className='font-semibold break-all'>{current.model}</h4>
                  {current.routes.map((route) => (
                    <article
                      key={route.access_model}
                      aria-label={route.access_model}
                      className='bg-background max-w-full min-w-0 space-y-3 rounded-lg border p-3'
                    >
                      <div className='flex min-w-0 flex-wrap items-center justify-between gap-2'>
                        <span className='text-primary min-w-0 font-mono text-sm font-semibold break-all'>
                          {route.access_model}
                        </span>
                        {route.channel_no && (
                          <span className='font-mono text-xs'>
                            {route.channel_no}
                          </span>
                        )}
                      </div>
                      <div className='grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3'>
                        <div className='min-w-0 space-y-1'>
                          <h5 className='text-xs font-medium'>
                            {t('Route quote')}
                          </h5>
                          {route.unit ? (
                            <PriceBreakdown
                              prices={route.prices}
                              unit={route.unit}
                              currency='CNY'
                            />
                          ) : (
                            <p className='text-muted-foreground text-xs'>
                              {t('Unconfirmed')}
                            </p>
                          )}
                        </div>
                        <div className='min-w-0 space-y-1'>
                          <h5 className='text-xs font-medium'>
                            {t('Upstream official original prices')}
                          </h5>
                          {Object.keys(route.original).length ? (
                            <PriceBreakdown
                              prices={route.original}
                              unit={route.unit}
                              currency='CNY'
                            />
                          ) : (
                            <p className='text-muted-foreground text-xs'>
                              {t('Not provided by upstream')}
                            </p>
                          )}
                        </div>
                        <div className='min-w-0 space-y-1 text-xs'>
                          <h5 className='font-medium'>
                            {t('Model multiplier')}
                          </h5>
                          <p className='text-primary font-mono font-semibold'>
                            {route.multiplier === undefined
                              ? t('Unconfirmed')
                              : `${route.multiplier}×`}
                          </p>
                          {route.input_coefficient && (
                            <p>
                              {t('Input pricing coefficient')}:{' '}
                              {route.input_coefficient}
                            </p>
                          )}
                          {route.output_coefficient && (
                            <p>
                              {t('Output pricing coefficient')}:{' '}
                              {route.output_coefficient}
                            </p>
                          )}
                        </div>
                      </div>
                      {route.issue &&
                        route.issue !== 'model_multiplier_not_provided' && (
                          <p className='text-xs text-amber-700 dark:text-amber-300'>
                            {t(
                              'This route has an unconfirmed price dimension or billing contract.'
                            )}
                          </p>
                        )}
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
