'use client';

import {
    FILE_UPLOAD_CONFIG,
    FileDownload,
    FileProgress,
    FileUpload,
    PageLayout,
    UploadFilesError,
    useFileItems,
    useFileProgress,
    useFileUploads,
    useSession,
} from '@image-web-convert/ui';
import {
    startTransition,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { ConversionState } from '..';
import { ConversionErrorBoundary } from './ConversionErrorBoundary';
import { PageInstructions } from './PageInstructions';
import { ErrorBoundary } from 'react-error-boundary';

export function ConversionPage() {
    const [conversionExt, setConversionExt] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [pageState, setPageState] = useState<ConversionState>('select');
    const { session, startSession, clearSession } = useSession();
    const config = useMemo(
        () => ({
            ...FILE_UPLOAD_CONFIG,
            sessionImageConfig:
                session?.imageConfig ?? FILE_UPLOAD_CONFIG.sessionImageConfig,
        }),
        [session?.imageConfig],
    );
    const { items, addItems, removeItem, clearFiles, errors, clearErrors } =
        useFileItems({ config });
    const { uploadedFiles, uploadFilesForm, rejectedFiles } = useFileUploads();
    const { progress, progressComplete, startProgress, cancelProgress } =
        useFileProgress();

    useEffect(() => {
        void startSession().catch(() => {
            // Submission retries and presents the actionable error to the user.
        });
    }, [startSession]);

    const startUploads = useCallback(
        async (formData: FormData, conversionExt: string) => {
            // UI transition to upload state
            startTransition(() => {
                setConversionExt(conversionExt);
                setPageState('upload');
                startProgress();
            });
            // API actions - create session then upload
            try {
                const newSession = await startSession();
                await uploadFilesForm(formData, newSession);
                startTransition(() => setPageState('upload_complete'));
            } catch (err) {
                if (err instanceof UploadFilesError)
                    setUploadError(err.message);
                cancelProgress();
                clearSession();
                setPageState('upload_error');
            }
        },
        [
            startSession,
            startProgress,
            uploadFilesForm,
            cancelProgress,
            clearSession,
        ],
    );

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
    }, [pageState, progressComplete]);

    return (
        <PageLayout>
            <div className="flex flex-col gap-4">
                <ErrorBoundary
                    fallbackRender={ConversionErrorBoundary}
                    onReset={resetAfterError}
                >
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
                                clearFiles={clearFiles}
                                errors={errors}
                                clearErrors={clearErrors}
                                onUploadStart={startUploads}
                            />
                        ) : pageState === 'upload' ||
                          pageState === 'upload_complete' ? (
                            <FileProgress items={items} progress={progress} />
                        ) : pageState === 'download' ? (
                            <FileDownload
                                conversionExt={conversionExt ?? ''}
                                items={items}
                                uploadedFiles={uploadedFiles}
                                rejectedFiles={rejectedFiles}
                            />
                        ) : pageState === 'upload_error' ? (
                            <ConversionErrorBoundary
                                error={{
                                    message:
                                        uploadError || 'Error uploading files',
                                }}
                                resetErrorBoundary={resetAfterError}
                            />
                        ) : null}
                    </div>
                </ErrorBoundary>
            </div>
        </PageLayout>
    );
}

export default ConversionPage;
