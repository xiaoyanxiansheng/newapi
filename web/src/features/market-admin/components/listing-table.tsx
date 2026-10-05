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

import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import type { MarketListing, UpdateListingPayload } from '../types'
import { ListingRow } from './listing-row'

type ListingTableProps = {
  rows: MarketListing[]
  loading: boolean
  selectedIds: Set<number>
  onSelectedChange: (id: number, selected: boolean) => void
  onSelectPage: (selected: boolean) => void
  onUpdate: (id: number, payload: UpdateListingPayload) => Promise<boolean>
  onDelete: (id: number) => void
}

const COLUMN_COUNT = 10
const SKELETON_ROWS = 8

export function ListingTable(props: ListingTableProps) {
  const { t } = useTranslation()
  const allSelected =
    props.rows.length > 0 &&
    props.rows.every((row) => props.selectedIds.has(row.id))
  const someSelected =
    !allSelected && props.rows.some((row) => props.selectedIds.has(row.id))

  const renderBody = () => {
    if (props.loading) {
      return Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <TableRow key={`skeleton-${index}`}>
          {Array.from({ length: COLUMN_COUNT }, (_, cell) => (
            <TableCell key={cell}>
              <Skeleton className='h-6 w-full' />
            </TableCell>
          ))}
        </TableRow>
      ))
    }
    if (props.rows.length === 0) {
      return (
        <TableRow>
          <TableCell
            colSpan={COLUMN_COUNT}
            className='text-muted-foreground h-32 text-center'
          >
            {t('No listings yet — generate them from a channel')}
          </TableCell>
        </TableRow>
      )
    }
    return props.rows.map((row) => (
      <ListingRow
        key={row.id}
        listing={row}
        selected={props.selectedIds.has(row.id)}
        onSelectedChange={props.onSelectedChange}
        onUpdate={props.onUpdate}
        onDelete={props.onDelete}
      />
    ))
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className='w-10'>
            <Checkbox
              aria-label={t('Select all on this page')}
              checked={allSelected}
              indeterminate={someSelected}
              onCheckedChange={(checked) =>
                props.onSelectPage(checked === true)
              }
            />
          </TableHead>
          <TableHead>{t('Channel')}</TableHead>
          <TableHead>{t('Model')}</TableHead>
          <TableHead>{t('Ratio')}</TableHead>
          <TableHead>{t('Enabled')}</TableHead>
          <TableHead>{t('Sellable')}</TableHead>
          <TableHead>{t('Monitoring')}</TableHead>
          <TableHead>{t('Description')}</TableHead>
          <TableHead>{t('Sort order')}</TableHead>
          <TableHead className='text-right'>{t('Actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{renderBody()}</TableBody>
    </Table>
  )
}
