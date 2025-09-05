'use client';

import { startTransition, useCallback, useEffect, useState } from 'react';
import { Button, FileDownload, FileProgress, FileUpload, PageLayout, useFileItems, useSession } from '@image-web-convert/ui';
import { ErrorBoundary, FallbackProps } from 'react-error-boundary';
import { useFileUploads, useFileProgress } from '@image-web-convert/ui';
import { FILE_UPLOAD_CONFIG } from '@image-web-convert/ui';

function fallbackRender({ error, resetErrorBoundary }: FallbackProps) {
    return (
        <div role="alert">
            <p>Something went wrong:</p>
            <pre className="text-destructive">{error.message}</pre>
            <Button variant="primary" onClick={() => resetErrorBoundary()}>
                Try again
            </Button>
        </div>
    );
}

type ConversionPageState = 'select' | 'upload' | 'upload_complete' | 'download';

function PageInstructions({ pageState }: { pageState: ConversionPageState }) {
    if (pageState === 'select') return <>
        Add images to convert. We'll check type and size right away. You can remove files anytime.
    </>

    if (pageState === 'upload' || pageState === 'upload_complete') return <>
        Converting files now. Don't close this page, and make sure to download files when they are complete.
    </>

    // TODO: Add dynamic expiry time, or make expiry time configurable?  Should it countdown?
    if (pageState === 'download') return <>
        Successfully converted files are now available to be downloaded until session expiry (about <strong>60 minutes</strong> from now). Save your files to keep a copy.
    </>
    
    return null;
}

export function ConversionPage() {
    const config = FILE_UPLOAD_CONFIG;
    const [pageState, setPageState] = useState<ConversionPageState>('select');
    const { items, addItems, removeItem, errors, clearErrors } = useFileItems({
        config,
    });
    const { startSession } = useSession();
    const { uploadedFiles, uploadFilesForm, rejectedFiles } = useFileUploads();
    const { progress, progressComplete, startProgress } = useFileProgress();
    
    const startUploads = useCallback(async (formData: FormData) => {
        startTransition(() => {
            setPageState('upload');
            startProgress();
        });

        // Create session then upload
        const newSession = await startSession();
        const res = await uploadFilesForm(formData, newSession);

        if (!res) {
            // TODO: Display upload errors somewhere
        } else {
            startTransition(() => setPageState('upload_complete'));
        }
    }, [startSession, startProgress, uploadFilesForm]);

    useEffect(() => {
        // Move to download state once uploads complete
        if (pageState === 'upload_complete' && progressComplete) {
            setPageState('download');
        }
    }, [pageState, progressComplete])

    return (
        <PageLayout>
            <div className="flex flex-col gap-4">
                <div className="mt-6">
                    <PageInstructions pageState={pageState} />
                </div>

                <div className="mt-2">
                    <ErrorBoundary
                        fallbackRender={fallbackRender}
                        onReset={(details) => {
                            // TODO: Reset the state of your app so the error doesn't happen again

                        }}
                    >
                        {pageState === 'select' ? (
                            <FileUpload
                                config={config}
                                items={items}
                                addItems={addItems}
                                removeItem={removeItem}
                                errors={errors}
                                clearErrors={clearErrors}
                                onUploadStart={startUploads}
                            />
                        ) : pageState === 'upload' || pageState === 'upload_complete' ? (
                            <FileProgress items={items} progress={progress} />
                        ) : pageState === 'download' ? (
                            <FileDownload items={items} uploadedFiles={uploadedFiles} rejectedFiles={rejectedFiles} />
                        ) : null}
                    </ErrorBoundary>
                </div>
            </div>
        </PageLayout>
    );
}

export default ConversionPage;
