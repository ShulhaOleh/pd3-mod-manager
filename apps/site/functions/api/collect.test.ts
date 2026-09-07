import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from './collect'

const VALID_ID = 'G-1Z7TF66B8X'

type Captured = { url: URL; init: RequestInit }

// Drives onRequestPost with a stubbed global fetch, awaiting the fire-and-forget
// upstream call (captured through waitUntil) so it has settled before assertions.
async function invoke(opts: {
    query: string
    body: string
    env?: { MODREX_GA_MEASUREMENT_ID?: string }
    connectingIp?: string
    upstreamStatus?: number
    upstreamError?: Error
}) {
    const captured: Captured[] = []
    const fetchMock = vi.fn(async (input: string | URL, init: RequestInit) => {
        captured.push({ url: new URL(String(input)), init })
        if (opts.upstreamError) throw opts.upstreamError
        return new Response(null, { status: opts.upstreamStatus ?? 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const headers = new Headers()
    if (opts.connectingIp) headers.set('CF-Connecting-IP', opts.connectingIp)
    const request = new Request(`https://modrex.net/api/collect${opts.query}`, {
        method: 'POST',
        headers,
        body: opts.body,
    })

    const pending: Promise<unknown>[] = []
    const res = await onRequestPost({
        request,
        env: opts.env ?? {},
        waitUntil: (p) => pending.push(p),
    })
    await Promise.all(pending)
    return { res, captured, fetchMock }
}

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('onRequestPost validation', () => {
    it('returns 400 when measurement_id or api_secret is missing', async () => {
        const a = await invoke({ query: '?api_secret=s', body: '{}' })
        expect(a.res.status).toBe(400)

        const b = await invoke({ query: `?measurement_id=${VALID_ID}`, body: '{}' })
        expect(b.res.status).toBe(400)
    })

    it('returns 403 when the id does not match the pinned env id', async () => {
        const { res, fetchMock } = await invoke({
            query: `?measurement_id=G-WRONG123&api_secret=s`,
            body: '{}',
            env: { MODREX_GA_MEASUREMENT_ID: VALID_ID },
        })
        expect(res.status).toBe(403)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('accepts the exact pinned id', async () => {
        const { res, captured } = await invoke({
            query: `?measurement_id=${VALID_ID}&api_secret=s`,
            body: '{}',
            env: { MODREX_GA_MEASUREMENT_ID: VALID_ID },
        })
        expect(res.status).toBe(204)
        expect(captured).toHaveLength(1)
    })

    it('falls back to a GA4 id shape check when no env id is pinned', async () => {
        const ok = await invoke({ query: `?measurement_id=${VALID_ID}&api_secret=s`, body: '{}' })
        expect(ok.res.status).toBe(204)

        const bad = await invoke({ query: `?measurement_id=not-a-ga-id&api_secret=s`, body: '{}' })
        expect(bad.res.status).toBe(403)
    })
})

describe('onRequestPost forwarding', () => {
    it('forwards to GA4 mp/collect carrying both credentials', async () => {
        const { captured } = await invoke({
            query: `?measurement_id=${VALID_ID}&api_secret=secret`,
            body: '{}',
        })
        const { url, init } = captured[0]
        expect(url.origin + url.pathname).toBe('https://www.google-analytics.com/mp/collect')
        expect(url.searchParams.get('measurement_id')).toBe(VALID_ID)
        expect(url.searchParams.get('api_secret')).toBe('secret')
        expect(init.method).toBe('POST')
    })

    it('injects the real client IP as ip_override into a JSON body', async () => {
        const { captured } = await invoke({
            query: `?measurement_id=${VALID_ID}&api_secret=s`,
            body: JSON.stringify({ client_id: '123', events: [] }),
            connectingIp: '203.0.113.7',
        })
        const forwarded = JSON.parse(String(captured[0].init.body))
        expect(forwarded.ip_override).toBe('203.0.113.7')
        expect(forwarded.client_id).toBe('123')
    })

    it('does not add ip_override when the edge did not set CF-Connecting-IP', async () => {
        const { captured } = await invoke({
            query: `?measurement_id=${VALID_ID}&api_secret=s`,
            body: JSON.stringify({ client_id: '123' }),
        })
        expect(JSON.parse(String(captured[0].init.body))).not.toHaveProperty('ip_override')
    })

    it('rejects malformed JSON before forwarding', async () => {
        const { res, captured } = await invoke({
            query: `?measurement_id=${VALID_ID}&api_secret=s`,
            body: 'not json',
            connectingIp: '203.0.113.7',
        })
        expect(res.status).toBe(400)
        expect(captured).toHaveLength(0)
    })

    it.each(['null', '[]', '"text"', '123'])('rejects non-object JSON: %s', async (body) => {
        const { res, captured } = await invoke({
            query: `?measurement_id=${VALID_ID}&api_secret=s`,
            body,
        })
        expect(res.status).toBe(400)
        expect(captured).toHaveLength(0)
    })

    it('preserves device, version and measured engagement while correcting the IP', async () => {
        const payload = {
            client_id: '123',
            device: { category: 'desktop', operating_system: 'Linux' },
            events: [
                {
                    name: 'app_activity',
                    params: { app_version: '0.14.0', engagement_time_msec: 60000 },
                },
            ],
            ip_override: '192.0.2.1',
        }
        const { captured } = await invoke({
            query: `?measurement_id=${VALID_ID}&api_secret=s`,
            body: JSON.stringify(payload),
            connectingIp: '203.0.113.7',
        })
        expect(JSON.parse(String(captured[0].init.body))).toEqual({
            ...payload,
            ip_override: '203.0.113.7',
        })
    })

    it('logs non-success upstream status codes', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {})
        const { res } = await invoke({
            query: `?measurement_id=${VALID_ID}&api_secret=secret`,
            body: '{}',
            upstreamStatus: 503,
        })
        expect(res.status).toBe(204)
        expect(log).toHaveBeenCalledWith('Analytics upstream rejected request', { status: 503 })
    })

    it('logs transport failures without leaking credentials from the error', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {})
        await invoke({
            query: `?measurement_id=${VALID_ID}&api_secret=secret`,
            body: '{}',
            upstreamError: new Error('Failed fetching https://example.com/?api_secret=secret'),
        })
        expect(log).toHaveBeenCalledExactlyOnceWith('Analytics upstream delivery failed')
    })
})
