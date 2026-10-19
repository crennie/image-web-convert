import { createPortal } from 'react-dom';
import {
    useCallback,
    useEffect,
    useId,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import {
    FaCheckCircle,
    FaExclamationCircle,
    FaClock,
    FaSpinner,
} from 'react-icons/fa';

export function StatusHelp({
    children,
    help,
    tone = 'waiting',
}: {
    children: ReactNode;
    help: string;
    tone?: 'success' | 'warning' | 'busy' | 'waiting';
}) {
    const id = useId();
    const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
        undefined,
    );
    const trigger = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const hide = () => {
        hideTimer.current = setTimeout(() => {
            if (document.activeElement !== trigger.current) setOpen(false);
        }, 150);
    };
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const updatePosition = useCallback(() => {
        const rect = trigger.current?.getBoundingClientRect();
        if (rect)
            setPosition({
                top: Math.min(
                    rect.bottom + 6,
                    Math.max(8, window.innerHeight - 160),
                ),
                left: Math.max(8, Math.min(rect.left, window.innerWidth - 272)),
            });
    }, []);
    useEffect(() => {
        const dismissOrReposition = () => {
            if (document.activeElement === trigger.current) updatePosition();
            else setOpen(false);
        };
        window.addEventListener('scroll', dismissOrReposition, true);
        window.addEventListener('resize', dismissOrReposition);
        return () => {
            clearTimeout(hideTimer.current);
            window.removeEventListener('scroll', dismissOrReposition, true);
            window.removeEventListener('resize', dismissOrReposition);
        };
    }, [updatePosition]);
    const show = () => {
        clearTimeout(hideTimer.current);
        updatePosition();
        setOpen(true);
    };
    const Icon =
        tone === 'success'
            ? FaCheckCircle
            : tone === 'warning'
              ? FaExclamationCircle
              : tone === 'busy'
                ? FaSpinner
                : FaClock;
    return (
        <span
            className="relative inline-flex max-w-full"
            onMouseEnter={show}
            onMouseLeave={hide}
        >
            <button
                ref={trigger}
                type="button"
                aria-describedby={open ? id : undefined}
                className="inline-flex items-center gap-2 text-left underline decoration-dotted underline-offset-4"
                onFocus={show}
                onBlur={() => setOpen(false)}
                onClick={show}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        event.stopPropagation();
                        setOpen(false);
                    }
                }}
            >
                <Icon
                    aria-hidden="true"
                    className={`size-3.5 shrink-0 ${tone === 'busy' ? 'motion-safe:animate-spin' : tone === 'success' ? 'text-primary' : tone === 'warning' ? 'text-destructive' : 'text-muted-foreground'}`}
                />
                <span>{children}</span>
            </button>
            {open &&
                createPortal(
                    <span
                        id={id}
                        role="tooltip"
                        onMouseEnter={() => clearTimeout(hideTimer.current)}
                        onMouseLeave={hide}
                        style={position}
                        className="fixed z-50 w-64 max-w-[75vw] rounded-lg bg-gray-950 p-3 text-sm font-normal text-white shadow-lg"
                    >
                        {help}
                    </span>,
                    document.body,
                )}
        </span>
    );
}
