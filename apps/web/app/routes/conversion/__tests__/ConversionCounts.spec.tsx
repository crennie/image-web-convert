import { fireEvent, render, screen } from '@testing-library/react';
import type {
    ApiConversionOperation,
    ConversionFile,
} from '@image-web-convert/schemas';
import { ConversionOperationStatus } from '../components/ConversionOperationStatus';
import { ConversionSelection } from '../components/ConversionSelection';
import { awaiting, completed, snapshot, time } from './conversionFixtures';

const uploaded = (id: string): ConversionFile => ({
    ...awaiting(id),
    status: 'uploaded',
    actualBytes: 3,
    uploadedAt: time,
});
const processing = (id: string): ConversionFile => ({
    ...uploaded(id),
    status: 'processing',
    actualBytes: 3,
    uploadedAt: time,
    startedAt: time,
});
const failed = (id: string): ConversionFile => ({
    ...awaiting(id),
    status: 'failed',
    finishedAt: time,
    error: { type: 'malformed_image', message: 'Invalid image' },
});
const cancelled = (id: string): ConversionFile => ({
    ...awaiting(id),
    status: 'cancelled',
    finishedAt: time,
    reason: 'user_cancelled',
});
const callbacks = { onRetry: vi.fn(), onCancel: vi.fn(), onDownload: vi.fn() };
function panel(operation: ApiConversionOperation, overrides = {}) {
    return (
        <ConversionOperationStatus
            {...callbacks}
            uploads={{}}
            cancelling={false}
            uploadsStopped={false}
            downloading={false}
            errors={{}}
            operation={operation}
            {...overrides}
        />
    );
}

it.each([
    {
        name: 'waiting for uploads',
        operation: snapshot([awaiting('a'), awaiting('b')]),
        expected: ['0 of 2 files finished', '0 completed.', '2 upload pending'],
        absent: ['queued', 'processing', 'failed', 'cancelled'],
    },
    {
        name: 'partially uploaded',
        operation: snapshot([awaiting('a'), uploaded('b')]),
        expected: [
            '0 of 2 files finished',
            '0 completed.',
            '1 upload pending · 1 queued',
        ],
        absent: ['processing', 'failed', 'cancelled'],
    },
    {
        name: 'fully queued',
        operation: snapshot([uploaded('a'), uploaded('b')], {
            status: 'queued',
        }),
        expected: ['0 of 2 files finished', '0 completed.', '2 queued'],
        absent: ['upload pending', 'processing', 'failed', 'cancelled'],
    },
    {
        name: 'processing with a queued sibling',
        operation: snapshot([processing('a'), uploaded('b')], {
            status: 'processing',
        }),
        expected: [
            '0 of 2 files finished',
            '0 completed, 1 processing.',
            '1 queued',
        ],
        absent: ['upload pending', 'failed', 'cancelled'],
    },
    {
        name: 'progressive success',
        operation: snapshot([completed('a'), processing('b'), uploaded('c')], {
            status: 'processing',
        }),
        expected: [
            '1 of 3 files finished',
            '1 completed, 1 processing.',
            '1 queued',
        ],
        absent: [
            'upload pending',
            'failed',
            'cancelled',
            '2 queued',
            '3 queued',
        ],
    },
    {
        name: 'mixed live outcomes',
        operation: snapshot(
            [
                completed('a'),
                failed('b'),
                cancelled('c'),
                processing('d'),
                uploaded('e'),
                awaiting('f'),
            ],
            { status: 'processing' },
        ),
        expected: [
            '3 of 6 files finished',
            '1 completed, 1 failed, 1 cancelled, 1 processing.',
            '1 upload pending · 1 queued',
        ],
        absent: ['0 failed', '0 cancelled'],
    },
])('shows accurate counts while $name', ({ operation, expected, absent }) => {
    render(panel(operation));
    const status = screen.getByRole('status');
    for (const text of expected) expect(status).toHaveTextContent(text);
    for (const text of absent) expect(status).not.toHaveTextContent(text);
    expect(screen.getByRole('button', { name: /Files/ })).toHaveTextContent(
        `Files (${operation.files.length})`,
    );
    expect(
        screen.queryByRole('button', { name: /as ZIP/ }),
    ).not.toBeInTheDocument();
});

it.each([
    {
        status: 'completed' as const,
        files: [completed('a'), completed('b')],
        counts: '2 completed.',
        ready: '2 of 2 images ready to download.',
        expanded: false,
    },
    {
        status: 'partially_completed' as const,
        files: [completed('a'), failed('b')],
        counts: '1 completed, 1 failed.',
        ready: '1 of 2 images ready to download.',
        expanded: true,
    },
    {
        status: 'failed' as const,
        files: [failed('a'), failed('b')],
        counts: '0 completed, 2 failed.',
        ready: '0 of 2 images ready to download.',
        expanded: true,
    },
    {
        status: 'cancelled' as const,
        files: [completed('a'), cancelled('b')],
        counts: '1 completed, 1 cancelled.',
        ready: '1 of 2 images ready to download.',
        expanded: true,
    },
    {
        status: 'cancelled' as const,
        files: [cancelled('a'), cancelled('b')],
        counts: '0 completed, 2 cancelled.',
        ready: '0 of 2 images ready to download.',
        expanded: true,
    },
])(
    'replaces live counters with accurate $counts outcomes',
    ({ status, files, counts, ready, expanded }) => {
        const { rerender } = render(
            panel(
                snapshot([processing('a'), uploaded('b')], {
                    status: 'processing',
                }),
            ),
        );
        rerender(panel(snapshot(files, { status })));
        const summary = screen.getByRole('status');
        expect(summary).toHaveTextContent(counts);
        expect(summary).not.toHaveTextContent(
            /files finished|upload pending|queued|\d processing/,
        );
        expect(screen.getByText(ready, { exact: false })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Files/ })).toHaveAttribute(
            'aria-expanded',
            String(expanded),
        );
        if (files.some((file) => file.status === 'completed'))
            expect(
                screen.getByRole('button', { name: /as ZIP/ }),
            ).toBeEnabled();
        else {
            expect(
                screen.queryByRole('button', { name: /as ZIP/ }),
            ).not.toBeInTheDocument();
            expect(
                screen.getByText(/No images are available to download/),
            ).toBeInTheDocument();
        }
    },
);

it('counts cancelled files as finished while active processing completes after cancellation', () => {
    const stop = {
        status: 'processing' as const,
        cancelRequestedAt: time,
        stopRequestedAt: time,
        stopReason: 'user_cancelled' as const,
    };
    const { rerender } = render(
        panel(
            snapshot([completed('a'), processing('b'), cancelled('c')], stop),
            { cancelling: true },
        ),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
        '2 of 3 files finished',
    );
    expect(screen.getByRole('status')).toHaveTextContent(
        '1 completed, 1 cancelled, 1 processing.',
    );
    expect(screen.getByRole('status')).toHaveTextContent(
        'Cancellation pending',
    );
    rerender(
        panel(
            snapshot([completed('a'), completed('b'), cancelled('c')], {
                ...stop,
                status: 'cancelled',
            }),
        ),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
        '2 completed, 1 cancelled.',
    );
    expect(screen.getByRole('status')).not.toHaveTextContent(
        /Cancellation pending|files finished|1 processing/,
    );
});

it('keeps byte progress and local upload errors out of authoritative outcome counts', () => {
    const operation = snapshot([awaiting('a'), awaiting('b')]);
    const { rerender } = render(
        panel(operation, {
            uploads: {
                'client-a': {
                    attempt: 1,
                    status: 'sending',
                    loaded: 3,
                    total: 3,
                },
                'client-b': { attempt: 1, status: 'error', loaded: 1 },
            },
        }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
        '0 completed.2 upload pending',
    );
    expect(screen.getByRole('status')).not.toHaveTextContent('1 failed');
    rerender(
        panel(
            snapshot([completed('a'), processing('b')], {
                status: 'processing',
            }),
            {
                uploads: {
                    'client-a': { attempt: 1, status: 'error', loaded: 1 },
                },
            },
        ),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
        '1 completed, 1 processing.',
    );
    expect(screen.getByRole('status')).not.toHaveTextContent(
        /upload pending|failed|queued/,
    );
});

it('retains accurate outcomes after timeout, lost polling, or access expiry', () => {
    const operation = snapshot([completed('a'), failed('b')], {
        status: 'partially_completed',
        stopRequestedAt: time,
        stopReason: 'conversion_timeout',
    });
    const { rerender } = render(
        panel(operation, { errors: { polling: 'Connection interrupted' } }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
        '1 completed, 1 failed.',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
        'Processing time limit reached',
    );
    rerender(panel(operation, { errors: { access: 'Session expired' } }));
    expect(screen.getByRole('status')).toHaveTextContent(
        '1 completed, 1 failed.',
    );
    expect(screen.getByRole('button', { name: /as ZIP/ })).toBeDisabled();
});

it('updates the selection summary when files or output format change', () => {
    const input = {
        items: [
            { id: 'a', file: new File(['abc'], 'a.png') },
            { id: 'b', file: new File(['12345'], 'b.png') },
        ],
        errors: [],
        disabled: false,
        outputMime: 'image/webp' as const,
        onMime: vi.fn(),
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onSubmit: vi.fn(),
        onDismissError: vi.fn(),
        onClearErrors: vi.fn(),
    };
    const { rerender } = render(<ConversionSelection {...input} />);
    expect(
        screen.getByText(/2 images · 8 B total · Convert to WEBP/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove b.png' }));
    expect(input.onRemove).toHaveBeenCalledWith(input.items[1]);
    rerender(
        <ConversionSelection
            {...input}
            items={input.items.slice(0, 1)}
            outputMime="image/jpeg"
        />,
    );
    expect(
        screen.getByText(/1 image · 3 B total · Convert to JPEG/),
    ).toBeInTheDocument();
    rerender(<ConversionSelection {...input} items={[]} />);
    expect(screen.queryByText(/total · Convert to/)).not.toBeInTheDocument();
    expect(
        screen.queryByRole('button', { name: 'Start conversion' }),
    ).not.toBeInTheDocument();
});

it('does not change conversion outcomes when downloading, retrying a download, or toggling the file list', () => {
    const operation = snapshot([completed('a'), completed('b')]);
    const { rerender } = render(panel(operation));
    const summary = screen.getByRole('status');
    const before = summary.textContent;
    fireEvent.click(screen.getByRole('button', { name: /as ZIP/ }));
    rerender(panel(operation, { downloading: true }));
    expect(summary.textContent).toBe(before);
    rerender(
        panel(operation, { errors: { download: 'Download failed; retry' } }),
    );
    expect(summary.textContent).toBe(before);
    expect(summary).not.toHaveTextContent('failed');
    fireEvent.click(screen.getByRole('button', { name: /Files/ }));
    fireEvent.click(screen.getByRole('button', { name: /Files/ }));
    expect(summary.textContent).toBe(before);
    expect(
        screen.getByText(/2 of 2 images ready to download/),
    ).toBeInTheDocument();
});
