import { Button, FileUpload, PageLayout } from '@image-web-convert/ui';
import { ErrorBoundary, FallbackProps } from 'react-error-boundary';


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

export function ConversionPage() {
    return (
        <PageLayout>
            <div className="mt-2 flex flex-col gap-4">
                {/* Add a row for instructions  */}
                <div className="min-h-5">

                </div>

                <div className="">
                    <ErrorBoundary
                        fallbackRender={fallbackRender}
                        onReset={(details) => {
                            // Reset the state of your app so the error doesn't happen again
                        }}
                    >
                        <FileUpload />
                    </ErrorBoundary>
                </div>
            </div>
        </PageLayout>
    );
}

export default ConversionPage;
