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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import type { BatchFailure } from '../types'

const MAX_VISIBLE_FAILURES = 20

type BatchResultDialogProps = {
  failures: BatchFailure[] | null
  onClose: () => void
}

export function BatchResultDialog(props: BatchResultDialogProps) {
  const { t } = useTranslation()
  const failures = props.failures ?? []
  const visible = failures.slice(0, MAX_VISIBLE_FAILURES)
  const hidden = failures.length - visible.length

  return (
    <Dialog
      open={props.failures !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('Some listings failed')}</DialogTitle>
          <DialogDescription>
            {t('{{count}} listings could not be updated.', {
              count: failures.length,
            })}
          </DialogDescription>
        </DialogHeader>
        <ul className='max-h-72 space-y-2 overflow-y-auto text-sm'>
          {visible.map((failure) => (
            <li key={failure.id} className='rounded-md border px-3 py-2'>
              <div className='font-mono'>
                {failure.model_name ?? `#${failure.id}`}
              </div>
              <div className='text-muted-foreground'>{failure.message}</div>
            </li>
          ))}
        </ul>
        {hidden > 0 ? (
          <p className='text-muted-foreground text-xs'>
            {t('And {{count}} more...', { count: hidden })}
          </p>
        ) : null}
        <DialogFooter>
          <Button onClick={props.onClose}>{t('Close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
