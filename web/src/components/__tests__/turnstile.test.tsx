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
import { cleanup, fireEvent, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { Turnstile } from '../turnstile'

function getTurnstileScript(): HTMLScriptElement {
  const script = document.querySelector('#cf-turnstile')
  if (!(script instanceof HTMLScriptElement)) {
    throw new Error('Turnstile script was not created')
  }
  return script
}

beforeEach(() => {
  delete window.turnstile
  document.querySelector('#cf-turnstile')?.remove()
})

afterEach(() => {
  cleanup()
  delete window.turnstile
  document.querySelector('#cf-turnstile')?.remove()
})

describe('Turnstile shared script lifecycle', () => {
  test('renders the remounted widget when the shared script finishes loading after unmount', () => {
    const first = render(<Turnstile siteKey='first-site' onVerify={vi.fn()} />)
    const script = getTurnstileScript()

    first.unmount()
    const remounted = render(
      <Turnstile siteKey='current-site' onVerify={vi.fn()} />
    )
    const renderWidget = vi.fn()
    window.turnstile = { render: renderWidget }
    fireEvent.load(script)

    expect(getTurnstileScript()).toBe(script)
    expect(document.querySelectorAll('#cf-turnstile')).toHaveLength(1)
    expect(renderWidget).toHaveBeenCalledExactlyOnceWith(
      remounted.container.firstElementChild,
      expect.objectContaining({ sitekey: 'current-site' })
    )
  })

  test('renders both mounted widgets when they share a pending script', () => {
    const first = render(<Turnstile siteKey='first-site' onVerify={vi.fn()} />)
    const script = getTurnstileScript()
    const second = render(
      <Turnstile siteKey='second-site' onVerify={vi.fn()} />
    )
    const renderWidget = vi.fn()

    expect(getTurnstileScript()).toBe(script)
    expect(document.querySelectorAll('#cf-turnstile')).toHaveLength(1)
    window.turnstile = { render: renderWidget }
    fireEvent.load(script)

    expect(renderWidget).toHaveBeenCalledTimes(2)
    expect(renderWidget).toHaveBeenCalledWith(
      first.container.firstElementChild,
      expect.objectContaining({ sitekey: 'first-site' })
    )
    expect(renderWidget).toHaveBeenCalledWith(
      second.container.firstElementChild,
      expect.objectContaining({ sitekey: 'second-site' })
    )
  })

  test('renders only the current props when they change before the script loads', () => {
    const previousVerify = vi.fn()
    const previousExpire = vi.fn()
    const currentVerify = vi.fn()
    const currentExpire = vi.fn()
    const mounted = render(
      <Turnstile
        siteKey='previous-site'
        onVerify={previousVerify}
        onExpire={previousExpire}
      />
    )
    const script = getTurnstileScript()
    mounted.rerender(
      <Turnstile
        siteKey='current-site'
        onVerify={currentVerify}
        onExpire={currentExpire}
      />
    )
    const renderWidget = vi.fn()
    window.turnstile = { render: renderWidget }
    fireEvent.load(script)

    expect(renderWidget).toHaveBeenCalledExactlyOnceWith(
      mounted.container.firstElementChild,
      expect.objectContaining({ sitekey: 'current-site' })
    )
    const options = renderWidget.mock.calls[0][1] as {
      callback: (token: string) => void
      'error-callback': () => void
      'expired-callback': () => void
    }
    options.callback('verified-token')
    options['error-callback']()
    options['expired-callback']()

    expect(currentVerify).toHaveBeenCalledExactlyOnceWith('verified-token')
    expect(currentExpire).toHaveBeenCalledTimes(2)
    expect(previousVerify).not.toHaveBeenCalled()
    expect(previousExpire).not.toHaveBeenCalled()
  })

  test('renders once after StrictMode replays the pending effect', () => {
    const mounted = render(
      <StrictMode>
        <Turnstile siteKey='strict-site' onVerify={vi.fn()} />
      </StrictMode>
    )
    const renderWidget = vi.fn()
    window.turnstile = { render: renderWidget }
    fireEvent.load(getTurnstileScript())

    expect(document.querySelectorAll('#cf-turnstile')).toHaveLength(1)
    expect(renderWidget).toHaveBeenCalledExactlyOnceWith(
      mounted.container.firstElementChild,
      expect.objectContaining({ sitekey: 'strict-site' })
    )
  })

  test('uses the already loaded API immediately after a later mount', () => {
    const first = render(<Turnstile siteKey='first-site' onVerify={vi.fn()} />)
    const script = getTurnstileScript()
    const renderWidget = vi.fn()
    window.turnstile = { render: renderWidget }
    fireEvent.load(script)
    expect(renderWidget).toHaveBeenCalledOnce()

    first.unmount()
    renderWidget.mockClear()
    const remounted = render(
      <Turnstile siteKey='loaded-site' onVerify={vi.fn()} />
    )

    expect(getTurnstileScript()).toBe(script)
    expect(document.querySelectorAll('#cf-turnstile')).toHaveLength(1)
    expect(renderWidget).toHaveBeenCalledExactlyOnceWith(
      remounted.container.firstElementChild,
      expect.objectContaining({ sitekey: 'loaded-site' })
    )
  })

  test('leaves the shared script available without rendering after all widgets unmount', () => {
    const first = render(<Turnstile siteKey='first-site' onVerify={vi.fn()} />)
    const second = render(
      <Turnstile siteKey='second-site' onVerify={vi.fn()} />
    )
    const script = getTurnstileScript()
    first.unmount()
    second.unmount()
    const renderWidget = vi.fn()
    window.turnstile = { render: renderWidget }
    fireEvent.load(script)

    expect(script).toBeInTheDocument()
    expect(renderWidget).not.toHaveBeenCalled()
  })
})
