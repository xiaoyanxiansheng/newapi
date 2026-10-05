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
import { KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CreateKeyForm } from './create-key-form'

type NoKeyNoticeProps = {
  isCreating: boolean
  onCreate: (name: string) => void
}

export function NoKeyNotice(props: NoKeyNoticeProps) {
  const { t } = useTranslation()

  return (
    <div className='border-primary/30 bg-primary/5 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between'>
      <div className='flex items-start gap-3'>
        <KeyRound
          className='text-primary mt-0.5 size-5 shrink-0'
          aria-hidden='true'
        />
        <div>
          <p className='text-sm font-semibold'>
            {t('Create an API key first')}
          </p>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Models are joined to an API key. Create one to start joining channels.'
            )}
          </p>
        </div>
      </div>
      <div className='sm:w-96'>
        <CreateKeyForm
          isCreating={props.isCreating}
          onCreate={props.onCreate}
        />
      </div>
    </div>
  )
}
