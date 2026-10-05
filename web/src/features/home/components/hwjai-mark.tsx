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
import { cn } from '@/lib/utils'

export function HwjaiMark(props: { className?: string }) {
  return (
    <svg
      aria-hidden='true'
      viewBox='0 0 40 40'
      fill='none'
      className={cn('size-full', props.className)}
    >
      <rect width='40' height='40' rx='12' fill='#12202F' />
      <path
        d='M12 10V30M12 21H27M27 16V30'
        stroke='#E8F6FF'
        strokeWidth='4'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <circle cx='27' cy='10' r='3' fill='#7DD3FC' />
    </svg>
  )
}
