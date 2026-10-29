import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useNotice } from './useNotice'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 15, 12))
})

afterEach(() => {
  vi.useRealTimers()
})

it('starts without a notice and exposes a notification callback', () => {
  const { result } = renderHook(() => useNotice())
  expect(result.current.message).toBe('')
  expect(result.current.notify).toEqual(expect.any(Function))
})

it('characterization: exposes the message passed to notify', () => {
  const { result } = renderHook(() => useNotice())
  act(() => {
    result.current.notify('Task deleted.')
  })
  expect(result.current.message).toBe('Task deleted.')
})

it('characterization: clears the notice after 4000 ms', () => {
  const { result } = renderHook(() => useNotice())
  act(() => {
    result.current.notify('Task deleted.')
  })
  act(() => {
    vi.advanceTimersByTime(3999)
  })
  expect(result.current.message).toBe('Task deleted.')
  act(() => {
    vi.advanceTimersByTime(1)
  })
  expect(result.current.message).toBe('')
})

it('characterization: restarts the 4000 ms window when a second notice arrives', () => {
  const { result } = renderHook(() => useNotice())
  act(() => {
    result.current.notify('First.')
  })
  act(() => {
    vi.advanceTimersByTime(3000)
  })
  act(() => {
    result.current.notify('Second.')
  })
  act(() => {
    vi.advanceTimersByTime(3000)
  })
  expect(result.current.message).toBe('Second.')
  act(() => {
    vi.advanceTimersByTime(1000)
  })
  expect(result.current.message).toBe('')
})
