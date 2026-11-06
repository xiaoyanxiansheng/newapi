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
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { translateUpstreamError } from '../errors'
import type { Preview } from '../types'
import { ProposalPrices } from './quote-prices'

export function SelectionPreview(props: {
  preview: Preview | null
  error?: string | null
  busy: boolean
  onClose: () => void
  onApply: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog
      open={props.preview !== null}
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onClose()
      }}
    >
      <DialogContent className='sm:max-w-4xl'>
        <DialogHeader>
          <DialogTitle>{t('Review selling prices')}</DialogTitle>
        </DialogHeader>
        {props.error && (
          <p role='alert' className='text-destructive text-sm'>
            {translateUpstreamError(props.error, t)}
          </p>
        )}
        {props.preview && (
          <>
            <p className='text-muted-foreground text-sm'>
              {t('Publish models using your existing Key: {{name}}', {
                name: props.preview.channel_name,
              })}
            </p>
            <div className='max-h-[60vh] space-y-3 overflow-auto'>
              {props.preview.proposals.map((row) => (
                <article
                  key={row.model}
                  className='bg-muted/20 space-y-3 rounded-xl border p-4'
                >
                  <h3 className='font-semibold'>{row.model}</h3>
                  {row.issue ? (
                    <p role='alert' className='text-destructive text-sm'>
                      {translateUpstreamError(row.issue, t)}
                    </p>
                  ) : (
                    <>
                      <div className='grid gap-4 sm:grid-cols-3'>
                        <div>
                          <h4 className='mb-2 text-xs font-semibold'>
                            {t('Upstream original prices')}
                          </h4>
                          <ProposalPrices
                            label={t('Dynamic original prices')}
                            expression={
                              row.billing_mode === 'tiered_expr'
                                ? row.original_expr
                                : undefined
                            }
                            prices={row.original}
                            unit={row.unit}
                            currency={row.display_currency}
                          />
                        </div>
                        <div>
                          <h4 className='mb-2 text-xs font-semibold'>
                            {t('Purchase cost')}
                          </h4>
                          <ProposalPrices
                            label={t('Dynamic purchase prices')}
                            expression={row.cost_expr}
                            prices={row.cost}
                            unit={row.unit}
                            currency={row.display_currency}
                          />
                        </div>
                        <div className='bg-primary/5 rounded-lg p-2'>
                          <h4 className='mb-2 text-xs font-semibold'>
                            {t('Plaza selling price')}
                          </h4>
                          <ProposalPrices
                            label={t('Dynamic selling prices')}
                            expression={
                              row.billing_mode === 'tiered_expr'
                                ? row.billing_expr
                                : undefined
                            }
                            prices={row.sale}
                            unit={row.unit}
                            currency={row.display_currency}
                          />
                        </div>
                      </div>
                      <p className='text-muted-foreground text-xs'>
                        {row.billing_mode === 'tiered_expr'
                          ? t('Dynamic Pricing')
                          : t('Fixed pricing')}
                        {' · '}
                        {t('Markup multiplier')}: {row.markup}x
                      </p>
                      {!row.enabled && (
                        <p className='text-muted-foreground text-xs'>
                          {t('This listing remains paused after applying.')}
                        </p>
                      )}
                    </>
                  )}
                </article>
              ))}
            </div>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Only selected listings are updated. Dynamic models keep their upstream tier and request rules. Global model prices remain unchanged.'
              )}
            </p>
            <div className='flex justify-end gap-2'>
              <Button
                variant='outline'
                disabled={props.busy}
                onClick={props.onClose}
              >
                {t('Cancel')}
              </Button>
              <Button
                disabled={
                  props.busy ||
                  props.preview.proposals.some((row) => !!row.issue)
                }
                onClick={props.onApply}
              >
                {t('Confirm publishing')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
