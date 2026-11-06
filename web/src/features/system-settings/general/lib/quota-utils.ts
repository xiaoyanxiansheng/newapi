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
import type { CurrencyConfig } from '@/stores/system-config-store'

export function getQuotaForOneDisplayedCurrencyUnit(
  currency: CurrencyConfig
): number {
  let exchangeRate = 1
  if (currency.quotaDisplayType === 'CNY') {
    exchangeRate = currency.usdExchangeRate
  } else if (currency.quotaDisplayType === 'CUSTOM') {
    exchangeRate = currency.customCurrencyExchangeRate
  }
  return Math.round(currency.quotaPerUnit / Math.max(exchangeRate, 0.000001))
}
