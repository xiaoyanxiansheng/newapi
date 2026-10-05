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
import { KeyRound, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import type { MarketKey } from '../types'
import { CreateKeyForm } from './create-key-form'

type KeySelectorProps = {
  keys: MarketKey[]
  selectedKey: MarketKey | null
  isCreating: boolean
  onSelect: (id: number) => void
  onCreate: (name: string) => void
}

export function KeySelector(props: KeySelectorProps) {
  const { t } = useTranslation()
  const items = props.keys.map((key) => ({
    value: String(key.id),
    label: key.name,
  }))

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <KeyRound className='text-muted-foreground size-4' aria-hidden='true' />
      <span className='text-muted-foreground text-sm'>
        {t('Current API key')}
      </span>
      <Select
        items={items}
        value={props.selectedKey ? String(props.selectedKey.id) : null}
        onValueChange={(value) => {
          if (typeof value === 'string') props.onSelect(Number(value))
        }}
      >
        <SelectTrigger size='sm' className='min-w-40' aria-label={t('API Key')}>
          <SelectValue placeholder={t('Select an API key')} />
        </SelectTrigger>
        <SelectContent align='start' alignItemWithTrigger={false}>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger
          render={
            <Button variant='outline' size='sm'>
              <Plus data-icon='inline-start' />
              {t('New key')}
            </Button>
          }
        />
        <PopoverContent align='start' className='w-80'>
          <CreateKeyForm
            isCreating={props.isCreating}
            onCreate={props.onCreate}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
