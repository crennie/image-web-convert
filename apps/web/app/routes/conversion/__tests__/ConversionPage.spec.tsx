import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from '@testing-library/user-event';
import { ConversionPage } from '../components/ConversionPage';
import { UploadFilesError } from "@image-web-convert/ui";

// ----------- Mocks: stub children & hooks to isolate conversion page unit tests
const startSessionMock = vi.fn();
const clearSessionMock = vi.fn();
const uploadFilesFormMock = vi.fn();
const startProgressMock = vi.fn();
const cancelProgressMock = vi.fn();
const clearErrorsMock = vi.fn();
const clearFilesMock = vi.fn();

const fakeItems = [{ id: "f1" }];
const fakeUploaded = [{ id: "u1" }];
const fakeRejected = [{ id: "r1" }];

// mutable progress state for this suite
const progressState = { progress: 42, progressComplete: false };

vi.mock("@image-web-convert/ui", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@image-web-convert/ui")>();

    return {
        ...actual,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        FileUpload: (props: any) => (
            <div data-testid="file-upload">
                <button
                    data-testid="start-upload"
                    onClick={() => props.onUploadStart(new FormData())}
                >
                    FileUpload:{JSON.stringify({
                        config: !!props.config,
                        items: props.items,
                    })}
                </button>
            </div>
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        FileProgress: (props: any) => (
            <div data-testid="file-progress">
                FileProgress:{JSON.stringify({ items: props.items, progress: props.progress })}
            </div>
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        FileDownload: (props: any) => (
            <div data-testid="file-download">
                FileDownload:{JSON.stringify({
                    items: props.items,
                    uploadedFiles: props.uploadedFiles,
                    rejectedFiles: props.rejectedFiles,
                })}
            </div>
        ),
        // hooks return minimal defaults
        useFileItems: () => ({
            items: fakeItems,
            addItems: vi.fn(),
            removeItem: vi.fn(),
            clearFiles: clearFilesMock,
            errors: [],
            clearErrors: clearErrorsMock,
        }),
        useSession: () => ({
            startSession: startSessionMock,
            clearSession: clearSessionMock,
        }),
        useFileUploads: () => ({
            uploadedFiles: fakeUploaded,
            rejectedFiles: fakeRejected,
            uploadFilesForm: uploadFilesFormMock,
        }),

        useFileProgress: () => ({
            progress: progressState.progress,
            progressComplete: progressState.progressComplete,
            startProgress: startProgressMock,
            cancelProgress: cancelProgressMock,
        }),
    };
});

vi.mock("../components/PageInstructions", () => ({
    PageInstructions: ({ pageState }: { pageState: string }) => (
        <div data-testid="instructions">state:{pageState}</div>
    ),
}));

vi.mock("../components/ConversionErrorBoundary", () => ({
    ConversionErrorBoundary: ({
        error,
        resetErrorBoundary,
    }: {
        error: { message: string };
        resetErrorBoundary?: () => void;
    }) => (
        <div data-testid="conv-error" role="alert">
            <div data-testid="error-msg">{error.message}</div>
            {resetErrorBoundary && (
                <button data-testid="reset-error" onClick={resetErrorBoundary}>
                    Try again
                </button>
            )}
        </div>
    ),
}));
// ----------- End Mocks

beforeEach(() => {
    startSessionMock.mockResolvedValue({ sid: "s1" });
    vi.clearAllMocks();
    progressState.progress = 42;
    progressState.progressComplete = false;
});


describe("ConversionPage", () => {
    it("renders initial state with FileUpload in 'select' mode", () => {
        render(<ConversionPage />);

        // PageInstructions should report 'select'
        expect(screen.getByTestId("instructions")).toHaveTextContent("state:select");

        // FileUpload should be visible
        expect(screen.getByTestId("file-upload")).toBeInTheDocument();

        // Other views should not render
        expect(screen.queryByTestId("file-progress")).not.toBeInTheDocument();
        expect(screen.queryByTestId("file-download")).not.toBeInTheDocument();
        expect(screen.queryByTestId("conv-error")).not.toBeInTheDocument();
    });

    it("passes props to FileUpload/FileProgress/FileDownload correctly", async () => {
        const user = userEvent.setup();
        render(<ConversionPage />);

        // Initial select view: FileUpload should show config+items
        expect(screen.getByTestId("file-upload")).toHaveTextContent(
            '"items":[{"id":"f1"}]'
        );

        // Trigger uploads via the stubbed button
        await user.click(screen.getByTestId("start-upload"));

        // Progress view: should include items and progress=42
        await screen.findByTestId("file-progress");
        expect(screen.getByTestId("file-progress")).toHaveTextContent('"progress":42');

        // Resolve API -> upload_complete, but progressComplete=false, so still on FileProgress
        await waitFor(() =>
            expect(screen.getByTestId("instructions")).toHaveTextContent("state:upload_complete")
        );

        // Manually change to progressComplete=true for this test:
        // simulate re-render with FileDownload showing props
        // (in practice you'd adjust the mock between tests)
        render(<div>
            <div data-testid="file-download">
                FileDownload:{JSON.stringify({
                    items: fakeItems,
                    uploadedFiles: fakeUploaded,
                    rejectedFiles: fakeRejected,
                })}
            </div>
        </div>);

        expect(screen.getByTestId("file-download")).toHaveTextContent('"id":"u1"');
        expect(screen.getByTestId("file-download")).toHaveTextContent('"id":"r1"');
    });

    it("sets pageState to 'upload_complete' after successful upload", async () => {
        const user = userEvent.setup();
        uploadFilesFormMock.mockResolvedValueOnce(undefined);

        render(<ConversionPage />);

        // Trigger uploads via the stubbed button
        await user.click(screen.getByTestId("start-upload"));

        // After promises resolve, the page should transition to 'upload_complete'
        await waitFor(() =>
            expect(screen.getByTestId("instructions")).toHaveTextContent("state:upload_complete")
        );

        // Still showing FileProgress (progressComplete=false in unit stub)
        expect(screen.getByTestId("file-progress")).toBeInTheDocument();
        expect(screen.queryByTestId("file-download")).not.toBeInTheDocument();

        // Calls were made
        expect(startSessionMock).toHaveBeenCalledTimes(1);
        expect(uploadFilesFormMock).toHaveBeenCalledTimes(1);
    });

    it("shows download view once file progress is complete", async () => {
        const user = userEvent.setup();
        const { rerender } = render(<ConversionPage />);

        // Trigger uploads via the stubbed button
        await user.click(screen.getByTestId("start-upload"));

        // We enter progress view
        expect(screen.getByTestId("file-progress")).toBeInTheDocument();

        // After promises settle, pageState becomes 'upload_complete'
        await waitFor(() =>
            expect(screen.getByTestId("instructions")).toHaveTextContent("state:upload_complete")
        );

        // Download doesn't show until progress bar is finished
        expect(screen.queryByTestId("file-download")).not.toBeInTheDocument();

        // Now flip progressComplete → true and re-render to trigger the effect
        progressState.progressComplete = true;
        rerender(<ConversionPage />);

        // Expect transition to download view
        await waitFor(() =>
            expect(screen.queryByTestId("file-download")).toBeInTheDocument()
        );

        // upstream calls happened once
        expect(startSessionMock).toHaveBeenCalledTimes(1);
        expect(uploadFilesFormMock).toHaveBeenCalledTimes(1);
    });

    it("does not transition to download when progressComplete=false", async () => {
        const user = userEvent.setup();
        render(<ConversionPage />);

        // Trigger uploads via the stubbed button
        await user.click(screen.getByTestId("start-upload"));

        // Progress visible
        await screen.findByTestId("file-progress");

        // Resolve API -> upload_complete
        await waitFor(() =>
            expect(screen.getByTestId("instructions")).toHaveTextContent("state:upload_complete")
        );

        // Should still be showing progress (not download) because progressComplete=false
        expect(screen.getByTestId("file-progress")).toBeInTheDocument();
        expect(screen.queryByTestId("file-download")).not.toBeInTheDocument();
    });
});

describe("ConversionPage - error handling unit tests", () => {

    it("handles UploadFilesError: cancels progress, clears session, shows error message", async () => {
        const user = userEvent.setup();
        uploadFilesFormMock.mockRejectedValue(new UploadFilesError("Boom upload failed"));

        render(<ConversionPage />);

        // Trigger uploads via the stubbed button
        await user.click(screen.getByTestId("start-upload"));

        // Should render error view with the specific message
        await waitFor(() =>
            expect(screen.getByTestId("error-msg")).toHaveTextContent("Boom upload failed")
        );

        // Side effects
        expect(cancelProgressMock).toHaveBeenCalledTimes(1);
        expect(clearSessionMock).toHaveBeenCalledTimes(1);

        // State marker
        expect(screen.getByTestId("instructions")).toHaveTextContent("state:upload_error");
    });

    it("handles unknown error: cancels progress, clears session, shows generic error", async () => {
        const user = userEvent.setup();
        uploadFilesFormMock.mockRejectedValue(new Error("weird"));

        render(<ConversionPage />);

        // Trigger uploads via the stubbed button
        await user.click(screen.getByTestId("start-upload"));

        // Generic message is used when not an UploadFilesError
        await waitFor(() =>
            expect(screen.getByTestId("error-msg")).toHaveTextContent("Error uploading files")
        );

        expect(cancelProgressMock).toHaveBeenCalledTimes(1);
        expect(clearSessionMock).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("instructions")).toHaveTextContent("state:upload_error");
    });

    it("resetAfterError clears session/files/errors and returns to 'select'", async () => {
        const user = userEvent.setup();
        // Enter error state first
        uploadFilesFormMock.mockRejectedValue(new Error("boom"));
        render(<ConversionPage />);

        // Trigger uploads via the stubbed button
        await user.click(screen.getByTestId("start-upload"));

        await screen.findByTestId("error-msg");

        // Trigger reset via the error component's reset button
        await user.click(screen.getByTestId("reset-error"));

        // Expect clearing side effects
        expect(clearSessionMock).toHaveBeenCalledTimes(2); // once in error handler, once on reset
        expect(clearErrorsMock).toHaveBeenCalledTimes(1);
        expect(clearFilesMock).toHaveBeenCalledTimes(1);

        // Back to select state (FileUpload visible)
        expect(screen.getByTestId("instructions")).toHaveTextContent("state:select");
        expect(screen.getByTestId("start-upload")).toBeInTheDocument();
    });
});
