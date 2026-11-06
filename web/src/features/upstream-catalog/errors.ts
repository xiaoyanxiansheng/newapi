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
import type { TFunction } from 'i18next'

const dimensions: Record<string, string> = {
  input: 'Input',
  output: 'Output',
  'cache read': 'Cache read',
  'cache write': 'Cache write',
  'image input': 'Image input',
  'audio input': 'Audio input',
  'audio output': 'Audio output',
  request: 'Per request',
}

export function translateUpstreamError(message: string, t: TFunction): string {
  const joinedHttp =
    /^joined route reading returned HTTP ([0-9]+) from \/api\/marketplace\/pins; sign in on the upstream Key page and retry authorization$/.exec(
      message
    )
  if (joinedHttp) {
    return t(
      'Joined route reading returned HTTP {{status}} from /api/marketplace/pins; sign in on the upstream Key page and retry authorization',
      { status: joinedHttp[1] }
    )
  }
  const http =
    /^upstream returned HTTP ([0-9]+); check account access and retry$/.exec(
      message
    )
  if (http) {
    return t(
      'Upstream returned HTTP {{status}}; check account access and retry',
      { status: http[1] }
    )
  }
  const catalogHttp = /^upstream catalog returned HTTP ([0-9]+)$/.exec(message)
  if (catalogHttp) {
    return t('Upstream catalog returned HTTP {{status}}', {
      status: catalogHttp[1],
    })
  }
  const missing =
    /^model (.+) has no confirmed (request|input|output) price$/.exec(message)
  if (missing) {
    return t('Model {{model}} has no confirmed {{dimension}} price', {
      model: missing[1],
      dimension: t(dimensions[missing[2]]),
    })
  }
  const cache = /^model (.+) has an invalid cache price$/.exec(message)
  if (cache) {
    return t('Model {{model}} has an invalid cache price', { model: cache[1] })
  }
  const unit = /^model (.+) has an unsupported billing unit$/.exec(message)
  if (unit) {
    return t('Model {{model}} has an unsupported billing unit', {
      model: unit[1],
    })
  }
  const dimensionMissing =
    /^(input|output|cache read|cache write|image input|audio input|audio output|request) price is missing from the upstream or local configuration; review model pricing first$/.exec(
      message
    )
  if (dimensionMissing) {
    return t(
      '{{dimension}} price is missing; review upstream and local model pricing first',
      { dimension: t(dimensions[dimensionMissing[1]]) }
    )
  }
  const ratio =
    /^(input|output|cache read|cache write|image input|audio input|audio output|request) price cannot use the existing ratio$/.exec(
      message
    )
  if (ratio) {
    return t('{{dimension}} price cannot use the existing ratio', {
      dimension: t(dimensions[ratio[1]]),
    })
  }
  const timeout = /^timeout of ([0-9]+)ms exceeded$/.exec(message)
  if (timeout) {
    return t(
      'The upstream request timed out. Retry to keep reading your existing Keys.'
    )
  }
  return t(message)
}
