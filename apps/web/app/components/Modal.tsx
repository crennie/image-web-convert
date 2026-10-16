import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Native dialog supplies background inertness and focus return; Tab wraps within its controls. */
export function Modal({
    open,
    title,
    onClose,
    children,
}: {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    useEffect(() => {
        const element = dialog.current;
        if (open && !element?.open) element?.showModal();
        if (!open && element?.open) element.close();
        return () => {
            if (element?.open) element.close();
        };
    }, [open]);
    return (
        <dialog
            ref={dialog}
            aria-labelledby={titleId}
            onKeyDown={(event) => {
                if (event.key !== 'Tab') return;
                const controls = Array.from(
                    event.currentTarget.querySelectorAll<HTMLElement>(
                        'button, [href], input, select, textarea, [tabindex]',
                    ),
                ).filter(
                    (element) =>
                        element.tabIndex >= 0 &&
                        !element.matches(':disabled') &&
                        !element.closest('[inert]') &&
                        element.getClientRects().length > 0,
                );
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (!first) {
                    event.preventDefault();
                    return;
                }
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-2xl border border-border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/60"
        >
            <h2 id={titleId} className="mb-3 text-xl font-bold">
                {title}
            </h2>
            {children}
        </dialog>
    );
}
