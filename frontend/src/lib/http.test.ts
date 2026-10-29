import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { request } from './http'

const fetchMock = vi.fn()
const inputLimitsMessage =
  'Check the task details: title up to 120 characters, description up to 2000 characters, and a valid due date.'
const genericMessage = 'The operation failed. Please try again.'

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

describe('request', () => {
  it('rejects a 422 response', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ msg: 'Invalid' }], 422))
    await expect(request('/todos', { method: 'POST' })).rejects.toThrow()
  })

  it('characterization: uses the input-limits message for a 422 response with a string detail', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Invalid input.' }, 422))
    await expect(request('/todos', { method: 'POST' })).rejects.toThrow(
      inputLimitsMessage,
    )
  })

  it('characterization: keeps the input-limits message when the 422 detail is an array', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: [{ msg: 'Invalid' }] }, 422),
    )
    await expect(request('/todos', { method: 'POST' })).rejects.toThrow(
      inputLimitsMessage,
    )
  })

  it('resolves a 204 response without reading a body', async () => {
    // Reading the empty body as JSON would reject, so resolving proves it is not read.
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(
      request('/todos/7', { method: 'DELETE' }),
    ).resolves.toBeUndefined()
  })

  it('characterization: reports a network failure as a connection problem', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(request('/todos')).rejects.toThrow(
      'Cannot connect to the server. Please try again.',
    )
  })

  it('characterization: reports a network failure as a connection problem when options are given without a signal', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(request('/todos', { method: 'POST' })).rejects.toThrow(
      'Cannot connect to the server. Please try again.',
    )
  })

  it('characterization: rethrows the original error when the request was aborted', async () => {
    const controller = new AbortController()
    const abortError = new DOMException(
      'The operation was aborted.',
      'AbortError',
    )
    fetchMock.mockImplementation(() => {
      controller.abort()
      return Promise.reject(abortError)
    })
    await expect(
      request('/todos', { signal: controller.signal }),
    ).rejects.toBe(abortError)
  })

  it('characterization: throws the server detail for another error response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Task not found.' }, 404))
    await expect(request('/todos/7')).rejects.toThrow('Task not found.')
  })

  it.each([
    [
      'a detail that is not a string',
      () => jsonResponse({ detail: [{ msg: 'x' }] }, 500),
    ],
    ['a body that is not JSON', () => new Response('Server error', { status: 500 })],
  ])('characterization: throws the generic message for %s', async (_case, respond) => {
    fetchMock.mockResolvedValue(respond())
    await expect(request('/todos/7')).rejects.toThrow(genericMessage)
  })

  it('sends the request under /api with a JSON content type', async () => {
    fetchMock.mockResolvedValue(jsonResponse([], 200))
    await expect(request('/todos')).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/todos',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    )
  })
})
