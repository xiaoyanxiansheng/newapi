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
import { Route as RouteIcon, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import type { MarketKey } from '../types'
import { DisabledHint } from './disabled-hint'
import { KeySelector } from './key-selector'

type MarketToolbarProps = {
  search: string
  onSearchChange: (value: string) => void
  keys: MarketKey[]
  selectedKey: MarketKey | null
  isCreating: boolean
  onSelectKey: (id: number) => void
  onCreateKey: (name: string) => void
  onOpenRouter: () => void
  showKeySelector: boolean
}

/** Search, API key selector and the router settings entry. */
export function MarketToolbar(props: MarketToolbarProps) {
  const { t } = useTranslation()
  const noKey = props.selectedKey === null

  return (
    <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
      <div className='relative w-full sm:w-72'>
        <Search
          className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2'
          aria-hidden='true'
        />
        <Input
          value={props.search}
          onChange={(event) => props.onSearchChange(event.target.value)}
          placeholder={t('Search model name or description...')}
          aria-label={t('Search model name or description...')}
          className='pl-8'
        />
      </div>
      {props.showKeySelector && (
        <KeySelector
          keys={props.keys}
          selectedKey={props.selectedKey}
          isCreating={props.isCreating}
          onSelect={props.onSelectKey}
          onCreate={props.onCreateKey}
        />
      )}
      <DisabledHint
        active={noKey}
        hint={t('Select or create an API key first')}
      >
        <Button
          variant='outline'
          size='sm'
          disabled={noKey}
          onClick={props.onOpenRouter}
        >
          <RouteIcon data-icon='inline-start' />
          {t('Model router settings')}
        </Button>
      </DisabledHint>
    </div>
  )
}
