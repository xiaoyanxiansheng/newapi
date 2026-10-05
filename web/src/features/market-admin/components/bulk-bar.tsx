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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type BulkBarProps = {
  selectedCount: number
  filteredCount: number
  busy: boolean
  onSelectAllFiltered: () => void
  onClear: () => void
  onSetRatio: (ratio: number) => Promise<boolean>
  onSetEnabled: (enabled: boolean) => void
  onDelete: () => void
}

export function BulkBar(props: BulkBarProps) {
  const { t } = useTranslation()
  const [ratioOpen, setRatioOpen] = useState(false)
  const [ratio, setRatio] = useState('')
  const ratioValue = Number(ratio)
  const ratioValid = ratio.trim() !== '' && ratioValue >= 0

  const submitRatio = async () => {
    if (!ratioValid) return
    const ok = await props.onSetRatio(ratioValue)
    if (ok) {
      setRatioOpen(false)
      setRatio('')
    }
  }

  return (
    <div className='bg-muted/50 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2'>
      <span className='text-sm font-medium'>
        {t('{{count}} selected', { count: props.selectedCount })}
      </span>
      {props.selectedCount < props.filteredCount ? (
        <Button variant='link' size='sm' onClick={props.onSelectAllFiltered}>
          {t('Select all {{count}} listings', { count: props.filteredCount })}
        </Button>
      ) : null}
      <Button variant='ghost' size='sm' onClick={props.onClear}>
        {t('Clear selection')}
      </Button>
      <div className='ml-auto flex items-center gap-2'>
        <Button
          variant='outline'
          size='sm'
          disabled={props.busy}
          onClick={() => setRatioOpen(true)}
        >
          {t('Set ratio')}
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={props.busy}
          onClick={() => props.onSetEnabled(true)}
        >
          {t('Enable')}
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={props.busy}
          onClick={() => props.onSetEnabled(false)}
        >
          {t('Disable')}
        </Button>
        <Button
          variant='destructive'
          size='sm'
          disabled={props.busy}
          onClick={props.onDelete}
        >
          {t('Delete')}
        </Button>
      </div>

      <Dialog open={ratioOpen} onOpenChange={setRatioOpen}>
        <DialogContent className='sm:max-w-sm'>
          <DialogHeader>
            <DialogTitle>{t('Set ratio')}</DialogTitle>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='market-bulk-ratio'>
              {t('Ratio for {{count}} selected listings', {
                count: props.selectedCount,
              })}
            </Label>
            <Input
              id='market-bulk-ratio'
              type='number'
              min={0}
              step='any'
              value={ratio}
              onChange={(event) => setRatio(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitRatio()
              }}
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setRatioOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button onClick={submitRatio} disabled={!ratioValid || props.busy}>
              {t('Apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
