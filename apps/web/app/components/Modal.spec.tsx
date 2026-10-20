import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from './Modal';

it('wraps past disabled, hidden and inert controls', () => {
    const rects = vi
        .spyOn(HTMLElement.prototype, 'getClientRects')
        .mockImplementation(function (this: HTMLElement) {
            return (this.closest('[hidden]')
                ? []
                : [new DOMRect()]) as unknown as DOMRectList;
        });
    try {
        render(
            <Modal open title="Choose an action" onClose={() => undefined}>
                <button disabled>Disabled</button>
                <div hidden>
                    <button>Hidden</button>
                </div>
                <div inert>
                    <button>Inert</button>
                </div>
                <button>First</button>
                <button>Last</button>
            </Modal>,
        );
        const dialog = screen.getByRole('dialog');
        const first = screen.getByRole('button', { name: 'First' });
        const last = screen.getByRole('button', { name: 'Last' });
        first.focus();
        fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
        expect(last).toHaveFocus();
        fireEvent.keyDown(dialog, { key: 'Tab' });
        expect(first).toHaveFocus();
    } finally {
        rects.mockRestore();
    }
});

it('contains Tab with no controls and closes on unmount', () => {
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close');
    try {
        const { rerender, unmount } = render(
            <Modal open title="Information" onClose={() => undefined}>
                <p>There are no actions.</p>
            </Modal>,
        );
        const dialog = screen.getByRole('dialog');
        const tab = new KeyboardEvent('keydown', {
            key: 'Tab',
            bubbles: true,
            cancelable: true,
        });
        dialog.dispatchEvent(tab);
        expect(tab.defaultPrevented).toBe(true);
        rerender(
            <Modal open={false} title="Information" onClose={() => undefined}>
                <p>There are no actions.</p>
            </Modal>,
        );
        expect(dialog).not.toHaveAttribute('open');
        rerender(
            <Modal open title="Information" onClose={() => undefined}>
                <p>There are no actions.</p>
            </Modal>,
        );
        expect(dialog).toHaveAttribute('open');
        unmount();
        expect(close).toHaveBeenCalledTimes(2);
    } finally {
        close.mockRestore();
    }
});
