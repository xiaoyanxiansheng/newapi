import { afterEach, expect, test, vi } from 'vitest'

import { discoverUpstreamPage } from '../lib/browser-discovery'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.body.innerHTML = ''
})

test.each([
  'selected',
  'empty',
  'unavailable',
  'optional-alias',
  'unrelated-invalid',
  'invalid-selected',
  'unassigned',
])(
  'authorization reads %s joined routes separately for each existing Key',
  async (state) => {
    const fetcher = vi.fn(async (path: string, options: RequestInit) => {
      expect(options.method).toBe('GET')
      expect(options.credentials).toBe('include')
      if (path === '/api/user/self') {
        return Response.json({ success: true, data: { id: 7 } })
      }
      if (path.startsWith('/api/token/?')) {
        return Response.json({
          success: true,
          data: {
            total: 2,
            items: [567, 568].map((id) => ({
              id,
              name: `Key ${id}`,
              key: 'sk-existing-authorized-secret',
              status: 1,
              used_quota: 0,
            })),
          },
        })
      }
      if (path === '/api/status') {
        return Response.json({
          success: true,
          data: { quota_per_unit: 500000 },
        })
      }
      if (path === '/api/pricing') {
        return Response.json({ success: true, data: [] })
      }
      if (path === '/api/marketplace/pins') {
        if (state === 'unavailable') return new Response('{}', { status: 401 })
        const pins = [
          {
            token_id: 567,
            listing_id: 287,
            base_model: 'claude-opus-5-5',
            listing_alias: 'claude-opus-5-5@s1c13',
          },
          {
            token_id: 567,
            listing_id: 581,
            base_model: 'claude-opus-5-5',
            listing_alias: 'claude-opus-5-5@s46c260',
          },
          {
            token_id: 568,
            listing_id: 749,
            base_model: 'claude-opus-5-5',
            listing_alias: 'claude-opus-5-5@s1c299',
          },
        ]
        if (state === 'optional-alias') {
          return Response.json({
            success: true,
            data: pins.map((pin) => ({
              token_id: String(pin.token_id),
              listing_id: String(pin.listing_id),
              base_model: pin.base_model,
            })),
          })
        }
        if (state === 'unrelated-invalid') {
          return Response.json({
            success: true,
            data: [...pins, { token_id: 999, listing_id: null }],
          })
        }
        if (state === 'invalid-selected') {
          return Response.json({
            success: true,
            data: [...pins, { token_id: 567, listing_id: null }],
          })
        }
        if (state === 'unassigned') {
          return Response.json({
            success: true,
            data: [...pins, { token_id: null, listing_id: 287 }],
          })
        }
        return Response.json({
          success: true,
          data:
            state === 'empty'
              ? []
              : [
                  {
                    token_id: 567,
                    listing_id: 287,
                    base_model: 'claude-opus-5-5',
                    listing_alias: 'claude-opus-5-5@s1c13',
                  },
                  {
                    token_id: 567,
                    listing_id: 581,
                    base_model: 'claude-opus-5-5',
                    listing_alias: 'claude-opus-5-5@s46c260',
                  },
                  {
                    token_id: 568,
                    listing_id: 749,
                    base_model: 'claude-opus-5-5',
                    listing_alias: 'claude-opus-5-5@s1c299',
                  },
                ],
        })
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetcher)
    const snapshot = await discoverUpstreamPage()
    const keys = snapshot.keys as Array<
      (typeof snapshot.keys)[number] & {
        joined_routes?: Array<{ listing_id: number }>
      }
    >
    if (state === 'unavailable') {
      expect(keys[0].joined_routes).toBeUndefined()
      expect(snapshot.keys[0]).toHaveProperty('joined_routes_issue', 'http_401')
      return
    }
    if (state === 'unassigned') {
      expect(
        snapshot.keys.every(
          (key) =>
            key.joined_routes === undefined &&
            key.joined_routes_issue === 'invalid_response'
        )
      ).toBe(true)
      return
    }
    if (state === 'invalid-selected') {
      expect(snapshot.keys[0].joined_routes).toBeUndefined()
      expect(snapshot.keys[0].joined_routes_issue).toBe('invalid_key_routes')
      expect(
        snapshot.keys[1].joined_routes?.map((route) => route.listing_id)
      ).toEqual([749])
      return
    }
    expect(keys[0].joined_routes?.map((route) => route.listing_id)).toEqual(
      state === 'empty' ? [] : [287, 581]
    )
    expect(keys[1].joined_routes?.map((route) => route.listing_id)).toEqual(
      state === 'empty' ? [] : [749]
    )
  }
)
