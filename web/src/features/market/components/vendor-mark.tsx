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
import { lazy, Suspense } from 'react'

const BrandIcon = lazy(async () => {
  const { getLobeIcon } = await import('@/lib/lobe-icon')
  return {
    default: (props: { icon: string }) => <>{getLobeIcon(props.icon, 24)}</>,
  }
})

export function VendorMark(props: { icon?: string; name?: string }) {
  const fallback = (
    <span
      aria-hidden='true'
      className='text-muted-foreground text-sm font-semibold'
    >
      {props.name?.charAt(0) || '?'}
    </span>
  )
  if (!props.icon) return fallback
  return (
    <Suspense fallback={fallback}>
      <BrandIcon icon={props.icon} />
    </Suspense>
  )
}
