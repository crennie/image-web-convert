import { act, renderHook } from '@testing-library/react';
import { useCosmeticProgress } from './useFileProgress';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('caps timer activity below completion and only completes explicitly', () => {
    const { result, unmount } = renderHook(() => useCosmeticProgress());
    act(() => result.current.startCosmeticProgress());
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.cosmeticPercent).toBe(90);
    act(() => result.current.completeCosmeticProgress());
    expect(result.current.cosmeticPercent).toBe(100);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.cosmeticPercent).toBe(100);
    unmount();
});

it('cancels and resets activity, and restarts without accumulating timers', () => {
    const { result, unmount } = renderHook(() => useCosmeticProgress());
    act(() => result.current.startCosmeticProgress());
    act(() => vi.advanceTimersByTime(800));
    expect(result.current.cosmeticPercent).toBeGreaterThan(0);
    act(() => result.current.startCosmeticProgress());
    expect(result.current.cosmeticPercent).toBe(0);
    expect(vi.getTimerCount()).toBe(1);
    act(() => result.current.cancelCosmeticProgress());
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.cosmeticPercent).toBe(0);
    unmount();
});

it('clears pending activity on unmount', () => {
    const { result, unmount } = renderHook(() => useCosmeticProgress());
    act(() => result.current.startCosmeticProgress());
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
});
