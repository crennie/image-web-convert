import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { ConversionFile } from '@image-web-convert/schemas';
import type { UploadAttempt } from '../api/conversionUploadTransport';
import { ConversionOperationStatus } from '../components/ConversionOperationStatus';
import { awaiting, completed, snapshot, time } from './conversionFixtures';

function props(
    overrides: Partial<ComponentProps<typeof ConversionOperationStatus>> = {},
): ComponentProps<typeof ConversionOperationStatus> {
    return {
        operation: snapshot(),
        uploads: {},
        cancelling: false,
        uploadsStopped: false,
        downloading: false,
        errors: {},
        onRetry: vi.fn(),
        onCancel: vi.fn(),
        onDownload: vi.fn(),
        onNewBatch: vi.fn(),
        localFiles: [
            {
                id: 'client-a',
                file: new File(['image'], 'same.png'),
                previewUrl: 'blob:original',
            },
        ],
        ...overrides,
    };
}
const attempts: {
    name: string;
    attempt?: UploadAttempt;
    text: string;
    retry?: boolean;
}[] = [
    { name: 'waiting', text: 'Waiting to upload' },
    {
        name: 'queued',
        attempt: { attempt: 1, status: 'queued', loaded: 0 },
        text: 'Waiting to upload',
    },
    {
        name: 'sending with total',
        attempt: {
            attempt: 1,
            status: 'sending',
            loaded: 1536,
            total: 1048576,
        },
        text: 'Uploading: 1.5 KB sent of 1.0 MB',
    },
    {
        name: 'sending without total',
        attempt: { attempt: 1, status: 'sending', loaded: 1024 },
        text: 'Uploading: 1.0 KB sent (total unknown)',
    },
    {
        name: 'awaiting confirmation',
        attempt: { attempt: 1, status: 'acknowledged', loaded: 3 },
        text: 'Transfer sent — awaiting server confirmation',
    },
    {
        name: 'reconciling',
        attempt: { attempt: 2, status: 'reconciling', loaded: 0 },
        text: 'Checking server before retry',
    },
    {
        name: 'upload error',
        attempt: { attempt: 1, status: 'error', loaded: 0 },
        text: 'Upload not confirmed — check server and retry',
        retry: true,
    },
    {
        name: 'conflict',
        attempt: { attempt: 1, status: 'error', loaded: 0, conflict: true },
        text: 'Upload conflict — check server and retry',
        retry: true,
    },
    {
        name: 'reconciliation failure',
        attempt: {
            attempt: 1,
            status: 'error',
            loaded: 0,
            reconciliationError: true,
        },
        text: 'Could not check upload status — retry when connected',
        retry: true,
    },
    {
        name: 'aborted',
        attempt: { attempt: 1, status: 'aborted', loaded: 0 },
        text: 'Local upload stopped — server outcome pending',
        retry: true,
    },
];
it.each(attempts)(
    'renders the $name upload state in a preview row',
    ({ attempt, text, retry }) => {
        const input = props({
            uploads: attempt ? { 'client-a': attempt } : {},
        });
        render(<ConversionOperationStatus {...input} />);
        const row = screen.getByRole('listitem', { name: 'same.png' });
        expect(within(row).getByText(text)).toBeInTheDocument();
        expect(
            within(row).getByRole('img', { name: 'Preview of same.png' }),
        ).toHaveAttribute('src', 'blob:original');
        expect(
            within(row).queryByRole('button', { name: /Download/ }),
        ).not.toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('0 completed.');
        expect(screen.getByRole('status')).not.toHaveTextContent(
            /0 (failed|cancelled|processing)/,
        );
        expect(
            screen.queryByRole('button', { name: 'Start new batch' }),
        ).not.toBeInTheDocument();
        if (retry) {
            fireEvent.click(
                within(row).getByRole('button', {
                    name: 'Retry upload same.png',
                }),
            );
            expect(input.onRetry).toHaveBeenCalledWith('client-a');
        } else
            expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    },
);
const serverStates: { name: string; file: ConversionFile; text: string }[] = [
    {
        name: 'uploaded',
        file: {
            ...awaiting(),
            status: 'uploaded',
            uploadedAt: time,
            actualBytes: 3,
        },
        text: 'Uploaded — waiting for processing',
    },
    {
        name: 'processing',
        file: {
            ...awaiting(),
            status: 'processing',
            uploadedAt: time,
            actualBytes: 3,
            startedAt: time,
        },
        text: 'processing',
    },
    { name: 'completed', file: completed(), text: 'completed' },
    {
        name: 'failed',
        file: {
            ...awaiting(),
            status: 'failed',
            finishedAt: time,
            error: { type: 'malformed_image', message: 'private diagnostic' },
        },
        text: 'failed',
    },
    {
        name: 'cancelled',
        file: {
            ...awaiting(),
            status: 'cancelled',
            finishedAt: time,
            reason: 'user_cancelled',
        },
        text: 'cancelled',
    },
];
it.each(serverStates)(
    'renders authoritative $name over a stale local upload error',
    ({ file, text }) => {
        render(
            <ConversionOperationStatus
                {...props({
                    operation: snapshot([file]),
                    uploads: {
                        'client-a': { attempt: 1, status: 'error', loaded: 0 },
                    },
                })}
            />,
        );
        const row = within(screen.getByRole('listitem', { name: 'same.png' }));
        expect(row.getByText(text, { exact: true })).toBeInTheDocument();
        expect(
            row.queryByRole('button', { name: /Retry upload/ }),
        ).not.toBeInTheDocument();
        if (file.status === 'completed') {
            expect(
                row.getByRole('button', { name: 'Download a.webp' }),
            ).toBeEnabled();
            expect(
                row.getByRole('button', {
                    name: 'Download same.png from thumbnail',
                }),
            ).toBeEnabled();
        } else
            expect(
                row.queryByRole('button', { name: /Download/ }),
            ).not.toBeInTheDocument();
        if (file.status === 'failed') {
            expect(row.getByText(/File conversion failed/)).toBeInTheDocument();
            expect(
                screen.queryByText('private diagnostic'),
            ).not.toBeInTheDocument();
        }
    },
);
it.each(['completed', 'partially_completed', 'failed', 'cancelled'] as const)(
    'offers available results and restart for a %s batch',
    (status) => {
        const failed = serverStates.find(
            (state) => state.name === 'failed',
        )?.file;
        if (!failed) throw new Error('Missing failed fixture');
        const files: ConversionFile[] =
            status === 'completed'
                ? [completed()]
                : status === 'failed'
                  ? [failed]
                  : status === 'partially_completed'
                    ? [
                          completed(),
                          { ...failed, id: 'b', clientId: 'client-b' },
                      ]
                    : [
                          completed(),
                          {
                              ...awaiting('b'),
                              status: 'cancelled',
                              finishedAt: time,
                              reason: 'user_cancelled',
                          },
                      ];
        const input = props({ operation: snapshot(files, { status }) });
        render(<ConversionOperationStatus {...input} />);
        expect(
            screen.queryByRole('button', { name: 'Cancel conversion' }),
        ).not.toBeInTheDocument();
        const zip = screen.queryByRole('button', {
            name: 'Download completed images as ZIP',
        });
        if (status === 'failed') expect(zip).not.toBeInTheDocument();
        else {
            if (!zip) throw new Error('Missing ZIP action');
            fireEvent.click(zip);
            expect(input.onDownload).toHaveBeenCalledWith(['a']);
        }
        fireEvent.click(
            screen.getByRole('button', { name: 'Start new batch' }),
        );
        expect(input.onNewBatch).toHaveBeenCalledOnce();
    },
);
it.each(['access', 'uploadsStopped', 'stopRequested'] as const)(
    'disables row retries when %s stops uploads',
    (reason) => {
        const input = props({
            errors:
                reason === 'access' ? { access: 'Session access ended' } : {},
            uploadsStopped: reason === 'uploadsStopped',
            operation: snapshot(
                undefined,
                reason === 'stopRequested'
                    ? {
                          stopRequestedAt: time,
                          stopReason: 'conversion_timeout',
                      }
                    : {},
            ),
            uploads: { 'client-a': { attempt: 1, status: 'error', loaded: 0 } },
        });
        render(<ConversionOperationStatus {...input} />);
        const retry = screen.getByRole('button', {
            name: 'Retry upload same.png',
        });
        expect(retry).toBeDisabled();
        fireEvent.click(retry);
        expect(input.onRetry).not.toHaveBeenCalled();
        expect(
            screen.queryByRole('button', { name: 'Start new batch' }),
        ).not.toBeInTheDocument();
    },
);
it('disables icon, thumbnail and ZIP downloads after access expires', () => {
    const input = props({
        operation: snapshot([completed()]),
        errors: { access: 'Session expired' },
    });
    render(<ConversionOperationStatus {...input} />);
    for (const button of screen.getAllByRole('button', { name: /Download/ })) {
        expect(button).toBeDisabled();
        fireEvent.click(button);
    }
    expect(input.onDownload).not.toHaveBeenCalled();
});
it('retains download controls after both preview sources fail', () => {
    const input = props({ operation: snapshot([completed()]) });
    render(<ConversionOperationStatus {...input} />);
    fireEvent.error(screen.getByRole('img', { name: 'Preview of same.png' }));
    fireEvent.error(
        screen.getByRole('img', { name: 'Preview unavailable for same.png' }),
    );
    expect(screen.getByText('No preview')).toBeInTheDocument();
    fireEvent.click(
        screen.getByRole('button', {
            name: 'Download same.png from thumbnail',
        }),
    );
    expect(input.onDownload).toHaveBeenCalledOnce();
});
