import { Button } from "@image-web-convert/ui";
import { FallbackProps } from "react-error-boundary";

export function ConversionErrorBoundary({ error, resetErrorBoundary }: FallbackProps) {
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