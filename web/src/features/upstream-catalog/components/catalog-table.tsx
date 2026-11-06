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
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LastSuccess } from '@/features/market/components/last-success'
import { ScoreBadge } from '@/features/market/components/score-badge'
import { SuccessStripes } from '@/features/market/components/success-stripes'
import { TokenConsumption } from '@/features/market/components/token-consumption'
import {
  formatListingId,
  formatRatio,
} from '@/features/market/lib/market-helpers'

import { translateUpstreamError } from '../errors'
import {
  getListingStatus,
  LISTING_STATUS_LABEL,
  LISTING_STATUS_COLOR,
} from '../lib/listing-status'
import type { CatalogRow } from '../types'
import { QuotePrices } from './quote-prices'

function CatalogField(props: {
  field: string
  label: string
  value?: string
  className?: string
  hideLabel?: boolean
  children: ReactNode
}) {
  return (
    <div
      role='cell'
      data-field={props.field}
      data-label={props.label}
      aria-label={props.value}
      className={`hwjai-catalog-field ${props.className ?? ''}`}
    >
      {!props.hideLabel && (
        <span className='hwjai-catalog-field-label'>{props.label}</span>
      )}
      {props.children}
    </div>
  )
}

export function CatalogTable(props: {
  rows: CatalogRow[]
  selected: Record<string, string>
  drafts?: Record<string, string>
  busy: boolean
  unavailable?: boolean
  markup: string
  onSelect: (model: string, selected: boolean, markup?: string) => void
  onReview: (model: string, pause: boolean) => void
  onPublish?: (model: string) => void
  onConfirmPrice?: (model: string) => void
  onState?: (model: string, enabled: boolean, remove?: boolean) => void
  onDescription?: (model: string) => void
  onDefaultSuccess?: (model: string, enabled: boolean) => void
  onProbeEndpoint?: (model: string, endpoint: string) => void
}) {
  const { t } = useTranslation()
  const changeLabels = {
    new: t('New model'),
    changed: t('Changed'),
    removed: t('Removed upstream'),
    unchanged: t('Unchanged'),
  }
  return (
    <div
      role='region'
      aria-label={t('Upstream model table')}
      className='hwjai-catalog-scroll max-w-full min-w-0 rounded-2xl border'
    >
      <table className='hwjai-catalog-table w-full text-left text-sm'>
        <thead className='sr-only'>
          <tr>
            <th className='p-3'>{t('Select')}</th>
            <th className='p-3'>{t('Model')}</th>
            <th className='p-3'>{t('Model ID')}</th>
            <th className='p-3'>{t('Token consumption')}</th>
            <th className='p-3'>{t('Upstream multiplier')}</th>
            <th className='p-3'>{t('Upstream original prices')}</th>
            <th className='p-3'>{t('Description')}</th>
            <th className='p-3'>{t('Markup multiplier')}</th>
            <th className='p-3'>{t('Actions')}</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => {
            const selected = row.model in props.selected
            const description =
              row.listing?.description || row.latest?.description || ''
            return (
              <tr
                key={row.model}
                className='hover:bg-primary/3 border-t align-top transition-colors'
              >
                <td colSpan={9} className='hwjai-catalog-card-cell'>
                  <article
                    aria-label={row.model}
                    className='hwjai-catalog-card'
                  >
                    <header className='hwjai-catalog-header'>
                      <div className='hwjai-catalog-identity'>
                        <input
                          type='checkbox'
                          aria-label={t('Select {{model}}', {
                            model: row.model,
                          })}
                          disabled={
                            props.busy ||
                            props.unavailable ||
                            !row.latest ||
                            !!row.latest.price_issue
                          }
                          checked={selected}
                          onChange={(e) =>
                            props.onSelect(row.model, e.target.checked)
                          }
                        />
                        <div className='hwjai-catalog-model-content'>
                          <span className='block font-semibold break-words'>
                            {row.model}
                          </span>
                          <div className='mt-2 flex flex-wrap items-center gap-1.5'>
                            {row.latest?.base_model && (
                              <span className='text-muted-foreground text-xs'>
                                {t('Base model')}: {row.latest.base_model}
                              </span>
                            )}
                            {row.latest?.channel_no && (
                              <span className='text-primary bg-primary/10 rounded-md px-2 py-1 font-mono text-xs font-semibold'>
                                {t('Upstream route ID')}:{' '}
                                <span>{row.latest.channel_no}</span>
                                {!!row.latest.supplier_id && (
                                  <>
                                    {' '}
                                    /{' '}
                                    {t('Supplier {{id}}', {
                                      id: row.latest.supplier_id,
                                    })}
                                  </>
                                )}
                              </span>
                            )}
                            {!!row.latest?.listing_id && (
                              <span className='text-primary bg-primary/10 rounded-md px-2 py-1 font-mono text-xs font-semibold'>
                                {t('Upstream listing ID')}:{' '}
                                {formatListingId(row.latest.listing_id)}
                              </span>
                            )}
                            <span
                              className={
                                row.change === 'unchanged'
                                  ? 'bg-muted text-muted-foreground rounded-md px-2 py-1 text-xs'
                                  : 'bg-primary/10 text-primary rounded-md px-2 py-1 text-xs'
                              }
                            >
                              {changeLabels[row.change]}
                            </span>
                            <span
                              className={
                                LISTING_STATUS_COLOR[getListingStatus(row)]
                              }
                            >
                              {t(LISTING_STATUS_LABEL[getListingStatus(row)])}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className='hwjai-catalog-head-fields'>
                        <CatalogField
                          field='model-id'
                          label={t('Model ID')}
                          value={
                            row.listing ? formatListingId(row.listing.id) : '—'
                          }
                          className='text-primary font-mono text-xs font-semibold'
                        >
                          {row.listing ? formatListingId(row.listing.id) : '—'}
                        </CatalogField>
                        <CatalogField
                          field='upstream-multiplier'
                          label={t('Upstream multiplier')}
                          value={
                            row.latest?.upstream_ratio
                              ? `${row.latest.upstream_ratio}x`
                              : '—'
                          }
                          className='font-mono text-sm'
                        >
                          {row.latest?.upstream_ratio
                            ? `${row.latest.upstream_ratio}x`
                            : '—'}
                        </CatalogField>
                        {row.listing && (
                          <CatalogField
                            field='selling-multiplier'
                            label={t('Selling multiplier')}
                            className='text-primary font-mono text-sm font-semibold'
                          >
                            {formatRatio(
                              row.monitoring?.price_ratio ?? row.listing.ratio
                            )}
                          </CatalogField>
                        )}
                      </div>
                    </header>
                    <div data-section='details' className='hwjai-catalog-body'>
                      <section
                        role={row.listing ? 'group' : undefined}
                        aria-label={
                          row.listing
                            ? t('Channel monitoring for {{model}}', {
                                model: row.model,
                              })
                            : undefined
                        }
                        className='hwjai-catalog-monitor'
                      >
                        <div className='hwjai-catalog-usage'>
                          <CatalogField
                            field='token-consumption'
                            label={t('Token consumption')}
                            hideLabel
                          >
                            <TokenConsumption
                              usage={row.monitoring?.stats?.probe_usage}
                            />
                          </CatalogField>
                          {row.listing && props.onProbeEndpoint && (
                            <label className='hwjai-catalog-protocol'>
                              <span className='hwjai-catalog-field-label'>
                                {t('Test protocol')}
                              </span>
                              <select
                                aria-label={t('Test protocol for {{model}}', {
                                  model: row.model,
                                })}
                                className='bg-background w-full rounded-md border p-1 text-xs'
                                disabled={props.busy}
                                value={row.listing.probe_endpoint ?? ''}
                                onChange={(event) =>
                                  props.onProbeEndpoint?.(
                                    row.model,
                                    event.target.value
                                  )
                                }
                              >
                                <option value=''>{t('Automatic')}</option>
                                <option value='openai'>Chat</option>
                                <option value='openai-response'>
                                  Responses
                                </option>
                                <option value='anthropic'>Messages</option>
                                <option value='gemini'>Gemini</option>
                              </select>
                            </label>
                          )}
                        </div>
                        {row.listing && props.onDefaultSuccess && (
                          <label className='text-muted-foreground mt-3 flex items-center gap-2 text-xs'>
                            <input
                              type='checkbox'
                              checked={row.listing.default_success ?? false}
                              disabled={props.busy}
                              onChange={(event) =>
                                props.onDefaultSuccess?.(
                                  row.model,
                                  event.target.checked
                                )
                              }
                            />
                            {t('Treat empty data as success')}
                          </label>
                        )}
                        {row.listing && (
                          <div className='hwjai-catalog-status space-y-2'>
                            <SuccessStripes
                              stats={row.monitoring?.stats}
                              defaultEmptySuccess={
                                row.monitoring?.default_success
                              }
                            />
                            <LastSuccess stats={row.monitoring?.stats} />
                            <ScoreBadge
                              score={row.monitoring?.score}
                              compact
                              className='justify-center'
                            />
                          </div>
                        )}
                      </section>
                      <section className='hwjai-catalog-prices'>
                        <CatalogField
                          field='upstream-prices'
                          label={t('Upstream original prices')}
                        >
                          {props.onConfirmPrice && row.latest && (
                            <Button
                              className='mb-2'
                              size='sm'
                              variant='outline'
                              disabled={props.busy || props.unavailable}
                              aria-label={t('Confirm prices for {{model}}', {
                                model: row.model,
                              })}
                              onClick={() => props.onConfirmPrice?.(row.model)}
                            >
                              {t('Confirm upstream prices')}
                            </Button>
                          )}
                          {row.latest && !row.latest.price_issue ? (
                            <div
                              role='group'
                              aria-label={t('Upstream original prices')}
                              className='hwjai-original-prices'
                            >
                              <QuotePrices quote={row.latest} original />
                            </div>
                          ) : (
                            <span className='text-destructive text-xs'>
                              {row.latest?.price_issue
                                ? translateUpstreamError(
                                    row.latest.price_issue,
                                    t
                                  )
                                : t('Removed upstream')}
                            </span>
                          )}
                        </CatalogField>
                      </section>
                      <section
                        className='hwjai-catalog-publishing'
                        data-section='publishing'
                      >
                        <section className='hwjai-catalog-description'>
                          <CatalogField
                            field='description'
                            label={t('Channel description')}
                          >
                            <p className='text-primary text-xs font-medium break-words whitespace-pre-wrap'>
                              {description || t('No description available.')}
                            </p>
                            {row.listing && props.onDescription && (
                              <Button
                                size='sm'
                                variant='ghost'
                                disabled={props.busy}
                                aria-label={t(
                                  'Edit description for {{model}}',
                                  {
                                    model: row.model,
                                  }
                                )}
                                onClick={() => props.onDescription?.(row.model)}
                              >
                                {t('Edit description')}
                              </Button>
                            )}
                          </CatalogField>
                        </section>
                        <footer className='hwjai-catalog-footer'>
                          <CatalogField
                            field='markup-multiplier'
                            label={t('Markup multiplier')}
                          >
                            <Input
                              className='w-24 font-mono'
                              aria-label={t('Markup for {{model}}', {
                                model: row.model,
                              })}
                              value={
                                props.drafts?.[row.model] ??
                                (selected
                                  ? props.selected[row.model]
                                  : row.markup_override)
                              }
                              placeholder={props.markup}
                              disabled={
                                props.busy ||
                                props.unavailable ||
                                !row.latest ||
                                !!row.latest.price_issue
                              }
                              onChange={(e) =>
                                props.onSelect(row.model, true, e.target.value)
                              }
                            />
                            <span className='text-muted-foreground mt-1 block text-[10px]'>
                              {t('Blank uses account markup')}
                            </span>
                          </CatalogField>
                          <CatalogField
                            field='actions'
                            label={t('Actions')}
                            className='hwjai-catalog-actions'
                          >
                            {props.onPublish && (
                              <Button
                                size='sm'
                                disabled={
                                  props.busy ||
                                  props.unavailable ||
                                  !row.latest ||
                                  !!row.latest.price_issue
                                }
                                onClick={() => props.onPublish?.(row.model)}
                              >
                                {t(
                                  row.listing
                                    ? 'Update selling price'
                                    : 'Publish model'
                                )}
                              </Button>
                            )}
                            {row.change !== 'unchanged' && (
                              <Button
                                variant='outline'
                                size='sm'
                                disabled={props.busy}
                                onClick={() => props.onReview(row.model, false)}
                              >
                                {t('Mark reviewed')}
                              </Button>
                            )}
                            {row.listing && props.onState && (
                              <div className='flex flex-wrap gap-2'>
                                <Button
                                  variant='outline'
                                  size='sm'
                                  disabled={
                                    props.busy ||
                                    (!row.listing.enabled &&
                                      (props.unavailable ||
                                        !row.latest ||
                                        !!row.latest.price_issue))
                                  }
                                  onClick={() =>
                                    props.onState?.(
                                      row.model,
                                      !row.listing?.enabled
                                    )
                                  }
                                >
                                  {t(
                                    row.listing.enabled
                                      ? 'Pause listing'
                                      : 'Resume listing'
                                  )}
                                </Button>
                                <Button
                                  variant='ghost'
                                  size='sm'
                                  disabled={props.busy}
                                  onClick={() =>
                                    props.onState?.(row.model, false, true)
                                  }
                                >
                                  {t('Unpublish model')}
                                </Button>
                              </div>
                            )}
                            {row.listing?.enabled && !props.onState && (
                              <Button
                                variant='ghost'
                                size='sm'
                                disabled={props.busy}
                                onClick={() => props.onReview(row.model, true)}
                              >
                                {t('Pause listing')}
                              </Button>
                            )}
                          </CatalogField>
                        </footer>
                      </section>
                    </div>
                  </article>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {props.rows.length === 0 && (
        <p className='text-muted-foreground p-8 text-center'>
          {t('No models match your current filters.')}
        </p>
      )}
    </div>
  )
}
