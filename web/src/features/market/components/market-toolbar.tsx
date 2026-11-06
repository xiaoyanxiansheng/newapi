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
import { Route as RouteIcon, KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import type { MarketKey } from '../types'
import { DisabledHint } from './disabled-hint'
import { KeySelector } from './key-selector'

type MarketToolbarProps = {
  keys: MarketKey[]
  selectedKey: MarketKey | null
  isCreating: boolean
  onSelectKey: (id: number) => void
  onCreateKey: (name: string) => void
  onOpenRouter: () => void
  showKeySelector: boolean
}
export function MarketToolbar(props: MarketToolbarProps) {
  const { t } = useTranslation()
  const noKey = props.selectedKey === null
  return (
    <section aria-label={t('API Access')} className='hwjai-market-access'>
      <span className='text-primary flex items-center gap-2 text-xs font-semibold'>
        <KeyRound className='size-4' aria-hidden='true' />
        {t('API Access')}
      </span>
      {props.showKeySelector && (
        <KeySelector
          keys={props.keys}
          selectedKey={props.selectedKey}
          isCreating={props.isCreating}
          onSelect={props.onSelectKey}
          onCreate={props.onCreateKey}
        />
      )}
      <div className='sm:ml-auto'>
        <DisabledHint
          active={noKey}
          hint={t('Select or create an API key first')}
        >
          <Button
            variant='outline'
            size='sm'
            disabled={noKey}
            onClick={props.onOpenRouter}
            className='rounded-lg'
          >
            <RouteIcon data-icon='inline-start' />
            {t('Model router settings')}
          </Button>
        </DisabledHint>
      </div>
    </section>
  )
}
