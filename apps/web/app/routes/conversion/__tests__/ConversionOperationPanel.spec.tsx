import { StrictMode } from 'react';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ConversionOperationPanel from '../components/ConversionOperationPanel';
import { ConversionOperationStatus } from '../components/ConversionOperationStatus';
import {
    awaiting,
    completed,
    session,
    snapshot,
    time,
} from './conversionFixtures';

beforeEach(() => {
    URL.createObjectURL = vi.fn().mockReturnValue('blob:preview');
    URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});
it('renders progressive authoritative outcomes and downloads without any local Files', () => {
    const failed = {
        ...awaiting('b'),
        status: 'failed' as const,
        finishedAt: time,
        error: {
            type: 'malformed_image' as const,
            message: '/internal/private/path',
        },
    };
    const operation = snapshot([completed(), failed, awaiting('c')]);
    const onDownload = vi.fn();
    const onRetry = vi.fn();
    render(
        <ConversionOperationStatus
            operation={operation}
            cancelling={false}
            uploadsStopped={false}
            downloading={false}
            errors={{}}
            uploads={{ 'client-c': { attempt: 1, loaded: 0, status: 'error' } }}
            onDownload={onDownload}
            onRetry={onRetry}
            onCancel={vi.fn()}
        />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
        '1 completed, 1 failed',
    );
    expect(screen.getByText(/File conversion failed/)).toHaveAttribute(
        'id',
        'b-error',
    );
    expect(
        screen.queryByText('/internal/private/path'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download a.webp' }));
    expect(onDownload).toHaveBeenCalledWith(
        operation.files[0].status === 'completed'
            ? operation.files[0].output
            : undefined,
    );
    fireEvent.click(
        screen.getByRole('button', { name: 'Retry upload same.png' }),
    );
    expect(onRetry).toHaveBeenCalledWith('client-c');
});
it('disables cancellation while pending without showing a fake cancelled status', () => {
    render(
        <ConversionOperationStatus
            operation={snapshot()}
            cancelling
            uploadsStopped
            downloading={false}
            errors={{}}
            uploads={{}}
            onDownload={vi.fn()}
            onRetry={vi.fn()}
            onCancel={vi.fn()}
        />,
    );
    expect(
        screen.getByRole('button', { name: 'Cancel conversion' }),
    ).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(
        'Cancellation pending',
    );
    expect(screen.getByRole('status')).toHaveTextContent('awaiting uploads');
});
it('rejects invalid selected files with reasons before creating a batch', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(
        <MemoryRouter>
            <ConversionOperationPanel />
        </MemoryRouter>,
    );
    const choose = (files: File[]) =>
        fireEvent.change(screen.getByLabelText('Choose images'), {
            target: { files },
        });
    choose([new File(['text'], 'notes.txt', { type: 'text/plain' })]);
    expect(screen.getByRole('alert')).toHaveTextContent(
        'notes.txt - Unsupported file type.',
    );
    expect(
        screen.getByRole('button', { name: 'Start conversion' }),
    ).toBeDisabled();

    const valid = new File(['abc'], 'valid.png', { type: 'image/png' });
    choose([valid]);
    choose([valid]);
    expect(screen.getByRole('alert')).toHaveTextContent(
        'valid.png - Duplicate of a file already added.',
    );
    choose([
        new File([new Uint8Array(20_000_001)], 'large.png', {
            type: 'image/png',
        }),
    ]);
    expect(screen.getByRole('alert')).toHaveTextContent(
        'large.png - Exceeds per-file size limit',
    );
    choose(
        Array.from(
            { length: 20 },
            (_, index) =>
                new File(['abc'], `${index}.png`, { type: 'image/png' }),
        ),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
        'You can add up to 20 files.',
    );
    expect(screen.getByText('20 files ready to upload.')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
});
it('keeps preview URLs stable and creates a fresh session only on a deliberate new batch', async () => {
    let sessions = 0;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/sessions')
            return new Response(
                JSON.stringify({
                    sid: `session-${++sessions}`,
                    token: session.token,
                    expiresAt: session.expiresAt,
                    imageConfig: session.imageConfig,
                }),
            );
        if (url.endsWith('/conversions')) {
            const intent = JSON.parse(init?.body as string);
            const file = completed();
            return new Response(
                JSON.stringify(
                    snapshot(
                        [{ ...file, clientId: intent.files[0].clientId }],
                        { sessionId: `session-${sessions}` },
                    ),
                ),
            );
        }
        throw Error('Unexpected request');
    });
    vi.stubGlobal('fetch', fetch);
    const ui = (
        <StrictMode>
            <MemoryRouter>
                <ConversionOperationPanel />
            </MemoryRouter>
        </StrictMode>
    );
    const { rerender, unmount } = render(ui);
    const choose = () =>
        fireEvent.change(screen.getByLabelText('Choose images'), {
            target: {
                files: [new File(['abc'], 'same.png', { type: 'image/png' })],
            },
        });
    choose();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    rerender(ui);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Start conversion' }));
    await screen.findByRole('button', { name: 'Download a.webp' });
    expect(sessions).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Start new batch' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    choose();
    fireEvent.click(screen.getByRole('button', { name: 'Start conversion' }));
    await screen.findByRole('button', { name: 'Download a.webp' });
    expect(sessions).toBe(2);
    unmount();
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/cancel'))).toBe(
        false,
    );
});
it('shows download failure and keeps the completed image available for retry', async () => {
    let downloadAttempts = 0;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/sessions')
            return new Response(
                JSON.stringify({ sid: session.sessionId, ...session }),
            );
        if (url.endsWith('/conversions')) {
            const intent = JSON.parse(init?.body as string);
            return new Response(
                JSON.stringify(
                    snapshot([
                        {
                            ...completed(),
                            clientId: intent.files[0].clientId,
                        },
                    ]),
                ),
            );
        }
        if (url.endsWith('/files/a')) {
            downloadAttempts++;
            return new Response('image', {
                status: downloadAttempts === 1 ? 503 : 200,
            });
        }
        throw Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
        () => undefined,
    );
    render(
        <MemoryRouter>
            <ConversionOperationPanel />
        </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Choose images'), {
        target: {
            files: [new File(['abc'], 'same.png', { type: 'image/png' })],
        },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start conversion' }));
    const retry = await screen.findByRole('button', {
        name: 'Download a.webp',
    });
    fireEvent.click(retry);
    expect(await screen.findByRole('alert')).toHaveTextContent(
        'Download failed. Please retry while this session is available.',
    );
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    await waitFor(() => expect(downloadAttempts).toBe(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(
        screen.getByRole('button', { name: 'Download a.webp' }),
    ).toBeEnabled();
});
it('offers a new batch when a lost creation acknowledgement outlives session access', async () => {
    let resolveCreation!: (response: Response) => void;
    const creation = new Promise<Response>((resolve) => {
        resolveCreation = resolve;
    });
    const fetch = vi.fn(async (url: string) => {
        if (url === '/api/sessions')
            return new Response(
                JSON.stringify({
                    sid: session.sessionId,
                    token: session.token,
                    expiresAt: new Date(Date.now() + 1_000).toISOString(),
                    imageConfig: session.imageConfig,
                }),
            );
        if (url.endsWith('/conversions')) return creation;
        throw Error('Unexpected request');
    });
    vi.stubGlobal('fetch', fetch);
    render(
        <MemoryRouter>
            <ConversionOperationPanel />
        </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Choose images'), {
        target: {
            files: [new File(['abc'], 'same.png', { type: 'image/png' })],
        },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start conversion' }));
    await waitFor(() =>
        expect(
            fetch.mock.calls.some(([url]) => url.endsWith('/conversions')),
        ).toBe(true),
    );
    await waitFor(
        () =>
            expect(screen.getByRole('alert')).toHaveTextContent(
                'Session access ended. Start a new batch to continue.',
            ),
        { timeout: 3_000 },
    );
    expect(
        screen.getByRole('button', { name: 'Start new batch' }),
    ).toBeEnabled();
    await act(async () => {
        resolveCreation(new Response(JSON.stringify(snapshot())));
        await creation;
    });
    expect(
        screen.queryByRole('button', { name: 'Cancel conversion' }),
    ).not.toBeInTheDocument();
});
it('Strict Mode, rerender, visibility and unmount never send cancellation; pagehide does', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/sessions')
            return new Response(
                JSON.stringify({ sid: session.sessionId, ...session }),
            );
        if (url.endsWith('/conversions')) {
            const intent = JSON.parse(init?.body as string);
            return new Response(
                JSON.stringify(
                    snapshot([
                        { ...awaiting(), clientId: intent.files[0].clientId },
                    ]),
                ),
            );
        }
        throw Error('exit lost');
    });
    vi.stubGlobal('fetch', fetch);
    // Leave upload in flight so exit can be tested independently of XHR completion.
    const xhr = {
        open: vi.fn(),
        setRequestHeader: vi.fn(),
        send: vi.fn(),
        abort: vi.fn(),
        upload: {},
    };
    vi.stubGlobal(
        'XMLHttpRequest',
        vi.fn(function () {
            return xhr;
        }),
    );
    const ui = (
        <StrictMode>
            <MemoryRouter>
                <ConversionOperationPanel />
            </MemoryRouter>
        </StrictMode>
    );
    const { rerender, unmount } = render(ui);
    fireEvent.change(screen.getByLabelText('Choose images'), {
        target: {
            files: [new File(['abc'], 'same.png', { type: 'image/png' })],
        },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start conversion' }));
    await screen.findByRole('button', { name: 'Cancel conversion' });
    rerender(ui);
    fireEvent(document, new Event('visibilitychange'));
    expect(
        fetch.mock.calls.filter(([url]) => url.endsWith('/cancel')),
    ).toHaveLength(0);
    fireEvent(window, new Event('pagehide'));
    await waitFor(() =>
        expect(
            fetch.mock.calls.filter(([url]) => url.endsWith('/cancel')),
        ).toHaveLength(1),
    );
    unmount();
    expect(
        fetch.mock.calls.filter(([url]) => url.endsWith('/cancel')),
    ).toHaveLength(1);
});
