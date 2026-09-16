import { useState } from 'react';
import {
    Button,
    FILE_UPLOAD_CONFIG,
    PageLayout,
    SessionProvider,
    useFileItems,
} from '@image-web-convert/ui';
import type { OutputMimeType } from '@image-web-convert/schemas';
import { ErrorBoundary } from 'react-error-boundary';
import { ConversionErrorBoundary } from './ConversionErrorBoundary';
import { useConversionOperation } from '../hooks/useConversionOperation';
import { isTerminal } from '../conversionViewModel';
import { ConversionSelection } from './ConversionSelection';
import { ConversionOperationStatus } from './ConversionOperationStatus';

function ConversionBatch({ onNewBatch }: { onNewBatch: () => void }) {
    const workflow = useConversionOperation();
    const { state } = workflow;
    const selection = useFileItems({
        config: {
            ...FILE_UPLOAD_CONFIG,
            sessionImageConfig:
                workflow.imageConfig ?? FILE_UPLOAD_CONFIG.sessionImageConfig,
        },
    });
    const [mime, setMime] = useState<OutputMimeType>('image/webp');
    return (
        <div className="my-6 flex flex-col gap-4">
            {!state.submitted && (
                <ConversionSelection
                    items={selection.items}
                    errors={selection.errors}
                    disabled={!state.connected || state.creating}
                    outputMime={mime}
                    onMime={setMime}
                    onAdd={selection.addItems}
                    onRemove={selection.removeItem}
                    onSubmit={() => void workflow.submit(selection.items, mime)}
                />
            )}
            {state.creating && <p role="status">Creating conversion batch…</p>}
            {Object.entries(state.errors).map(
                ([category, message]) =>
                    message && (
                        <p role="alert" key={category}>
                            {message}
                        </p>
                    ),
            )}
            {(state.errors.creation || state.errors.session) &&
                !state.errors.access &&
                !state.creationRejected && (
                    <Button
                        disabled={!state.connected || state.creating}
                        onClick={() =>
                            void workflow.submit(selection.items, mime)
                        }
                    >
                        Retry batch creation
                    </Button>
                )}
            {state.operation && (
                <ConversionOperationStatus
                    {...state}
                    operation={state.operation}
                    onRetry={(id) => void workflow.retryUpload(id)}
                    onCancel={() => void workflow.cancel()}
                    onDownload={(result) => void workflow.download(result)}
                />
            )}
            {(state.errors.access ||
                state.creationRejected ||
                (state.operation && isTerminal(state.operation))) && (
                <Button onClick={onNewBatch}>Start new batch</Button>
            )}
        </div>
    );
}

export default function ConversionOperationPanel() {
    const [batch, setBatch] = useState(0);
    // A new provider instance guarantees a fresh session without changing the
    // existing cached startSession contract. Retries retain this same boundary.
    return (
        <PageLayout>
            <ErrorBoundary
                key={batch}
                fallbackRender={(props) => (
                    <ConversionErrorBoundary
                        {...props}
                        error={
                            new Error(
                                'Unable to display this batch. Please try a new batch.',
                            )
                        }
                    />
                )}
                onReset={() => setBatch((value) => value + 1)}
            >
                <SessionProvider>
                    <ConversionBatch
                        onNewBatch={() => setBatch((value) => value + 1)}
                    />
                </SessionProvider>
            </ErrorBoundary>
        </PageLayout>
    );
}
