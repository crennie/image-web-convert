'use client';

import { startTransition, useCallback, useEffect, useState } from 'react';
import { Button, FileDownload, FileProgress, FileUpload, PageLayout, UploadFilesError, useFileItems, useSession } from '@image-web-convert/ui';
import { ErrorBoundary, FallbackProps } from 'react-error-boundary';
import { useFileUploads, useFileProgress } from '@image-web-convert/ui';
import { FILE_UPLOAD_CONFIG } from '@image-web-convert/ui';

function FallbackRender({ error, resetErrorBoundary }: FallbackProps) {
    return (
        <div role="alert">
            <p>Something went wrong:</p>
            <div className="text-lg text-destructive">{error.message}</div>
            <Button variant="primary" className="mt-4"
                onClick={resetErrorBoundary}
            >
                Try again
            </Button>
        </div>
    );
}

type ConversionPageState = 'select' | 'upload' | 'upload_complete' | 'upload_error' | 'download';

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
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [pageState, setPageState] = useState<ConversionPageState>('select');
    const { items, addItems, removeItem, clearFiles, errors, clearErrors } = useFileItems({ config });
    const { startSession, clearSession } = useSession();
    const { uploadedFiles, uploadFilesForm, rejectedFiles } = useFileUploads();
    const { progress, progressComplete, startProgress, cancelProgress } = useFileProgress();

    const startUploads = useCallback(async (formData: FormData) => {
        // UI transition to upload state
        startTransition(() => {
            setPageState('upload');
            startProgress();
        });
        // API actions - create session then upload
        try {
            const newSession = await startSession();
            await uploadFilesForm(formData, newSession);
            startTransition(() => setPageState('upload_complete'));
        } catch (err) {
            if (err instanceof UploadFilesError) setUploadError(err.message);
            cancelProgress();
            clearSession();
            setPageState('upload_error');
        }
    }, [startSession, startProgress, uploadFilesForm, cancelProgress, clearSession]);

    const resetAfterError = useCallback(() => {
        clearSession();
        setUploadError(null);
        clearErrors();
        clearFiles();
        setPageState('select');
    }, [clearSession, clearErrors, clearFiles]);

    useEffect(() => {
        // Move to download state once uploads complete
        if (pageState === 'upload_complete' && progressComplete) {
            setPageState('download');
        }
    }, [pageState, progressComplete])

    return (
        <PageLayout>
            <div className="flex flex-col gap-4">
                <ErrorBoundary fallbackRender={FallbackRender} onReset={resetAfterError}>
                    <div className="mt-6">
                        <PageInstructions pageState={pageState} />
                    </div>

                    <div className="mt-2">
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
                        ) : pageState === "upload_error" ? (
                            <FallbackRender error={{ message: uploadError || "Error uploading files" }}
                                resetErrorBoundary={resetAfterError} />
                        ) : null}
                    </div>
                </ErrorBoundary>
            </div>
        </PageLayout>
    );
}

export default ConversionPage;
