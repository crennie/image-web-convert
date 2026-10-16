import { useContext, useEffect, useState } from 'react';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router';
import { Button } from '@image-web-convert/ui';
import { Modal } from '../../../components/Modal';

function LeaveDialog({
    open,
    active,
    onStay,
    onLeave,
}: {
    open: boolean;
    active: boolean;
    onStay: () => void;
    onLeave: () => void;
}) {
    return (
        <Modal
            open={open}
            title={active ? 'Leave this conversion?' : 'Leave these results?'}
            onClose={onStay}
        >
            <p>
                {active
                    ? 'Leaving stops uploads and requests cancellation when possible. Active processing may finish, but you will lose access to these results from this page.'
                    : 'Download the images you want to keep before leaving. You will lose access to this batch from this page.'}
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
                <Button autoFocus variant="secondary" onClick={onStay}>
                    Stay on this batch
                </Button>
                <Button onClick={onLeave}>
                    {active ? 'Leave conversion' : 'Leave results'}
                </Button>
            </div>
        </Modal>
    );
}
function RouteGuard({
    active,
    onLeave,
}: {
    active: boolean;
    onLeave?: () => void;
}) {
    const blocker = useBlocker(true);
    return (
        <LeaveDialog
            open={blocker.state === 'blocked'}
            active={active}
            onStay={() => blocker.state === 'blocked' && blocker.reset()}
            onLeave={() => {
                if (blocker.state === 'blocked') {
                    onLeave?.();
                    blocker.proceed();
                }
            }}
        />
    );
}
export function BatchNavigationGuard({
    active,
    onNewBatch,
    onLeave,
}: {
    active: boolean;
    onNewBatch?: () => void;
    onLeave?: () => void;
}) {
    const router = useContext(UNSAFE_DataRouterContext);
    const [restart, setRestart] = useState(false);
    useEffect(() => {
        const warn = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, []);
    return (
        <>
            {router && <RouteGuard active={active} onLeave={onLeave} />}
            {onNewBatch && (
                <Button
                    variant="ghost"
                    className="self-start px-2 underline-offset-4 hover:underline"
                    onClick={() => setRestart(true)}
                >
                    Start new batch
                </Button>
            )}
            <LeaveDialog
                open={restart}
                active={active}
                onStay={() => setRestart(false)}
                onLeave={() => {
                    setRestart(false);
                    onNewBatch?.();
                }}
            />
        </>
    );
}
