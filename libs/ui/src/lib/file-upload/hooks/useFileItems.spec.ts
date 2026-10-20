import { act, renderHook } from '@testing-library/react';
import { FILE_UPLOAD_CONFIG } from '../file-upload.config';
import { useFileItems } from './useFileItems';

beforeEach(() => {
    URL.createObjectURL = vi.fn().mockReturnValue('blob:preview');
    URL.revokeObjectURL = vi.fn();
});
const image = (name: string) =>
    new File(['image'], name, { type: 'image/png' });
const invalid = () => new File(['text'], 'bad.txt', { type: 'text/plain' });
const setup = () =>
    renderHook(() =>
        useFileItems({
            config: { ...FILE_UPLOAD_CONFIG, accept: ['image/png'] },
        }),
    );

it('replaces stale errors, preserves current rejections, and treats empty additions as no-ops', () => {
    const { result } = setup();
    act(() => result.current.addItems([invalid()]));
    const previous = result.current.selectionErrors[0].id;
    act(() => result.current.addItems([]));
    expect(result.current.selectionErrors[0].id).toBe(previous);
    act(() => result.current.addItems([image('one.png'), invalid()]));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.errors).toHaveLength(1);
    expect(result.current.selectionErrors[0].id).not.toBe(previous);
    act(() => result.current.addItems([image('two.png')]));
    expect(result.current.errors).toEqual([]);
});
it('clears errors on removal and clear-all and disposes previews', () => {
    const { result } = setup();
    act(() => result.current.addItems([image('one.png'), invalid()]));
    act(() => result.current.removeItem(result.current.items[0]));
    expect(result.current.errors).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    act(() => result.current.addItems([invalid()]));
    act(() => result.current.clearFiles());
    expect(result.current.errors).toEqual([]);
});
it('dismisses identical errors independently and permits new validation errors', () => {
    const { result } = setup();
    act(() => result.current.addItems([invalid(), invalid()]));
    const second = result.current.selectionErrors[1];
    act(() =>
        result.current.dismissError(result.current.selectionErrors[0].id),
    );
    expect(result.current.selectionErrors).toEqual([second]);
    act(() => result.current.dismissError(second.id));
    expect(result.current.errors).toEqual([]);
    act(() => result.current.addItems([invalid()]));
    expect(result.current.errors).toHaveLength(1);
});
it('revokes removed and remaining previews exactly once across reselection and unmount', () => {
    vi.mocked(URL.createObjectURL)
        .mockReturnValueOnce('blob:first')
        .mockReturnValueOnce('blob:second')
        .mockReturnValueOnce('blob:third');
    const { result, unmount } = setup();
    act(() =>
        result.current.addItems([image('first.png'), image('second.png')]),
    );
    act(() => result.current.removeItem(result.current.items[0]));
    act(() => result.current.addItems([image('third.png')]));
    unmount();
    expect(vi.mocked(URL.revokeObjectURL).mock.calls).toEqual([
        ['blob:first'],
        ['blob:second'],
        ['blob:third'],
    ]);
});
