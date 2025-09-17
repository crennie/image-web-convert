import { render, screen } from "@testing-library/react";
import { PageInstructions } from "../components/PageInstructions";

// --- minimal stubs for external deps ---
const displayDateTimeMock = vi.fn((d: Date) => `MOCK_${d.getTime()}`);
vi.mock("@image-web-convert/ui", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@image-web-convert/ui")>();
    return {
        ...actual,
        displayDateTime: (d: Date) => displayDateTimeMock(d),
    };
});

vi.mock("../../../ui.config", () => ({
    UI_SETTINGS_DISPLAY: { uploadedFileLifespan: "15 minutes" },
    UPLOADED_FILE_LIFESPAN_MS: 15 * 60 * 1000,
}));

beforeEach(() => {
    vi.clearAllMocks();
});

describe("PageInstructions", () => {
    it("renders select message", () => {
        render(<PageInstructions pageState="select" />);
        expect(
            screen.getByText(/Add images to convert/i)
        ).toBeInTheDocument();
    });

    it("renders upload message for 'upload' and 'upload_complete' (case when file progress not complete)", () => {
        const { rerender } = render(<PageInstructions pageState="upload" />);
        expect(
            screen.getByText(/Converting your files/i)
        ).toBeInTheDocument();

        rerender(<PageInstructions pageState="upload_complete" />);
        expect(
            screen.getByText(/Converting your files/i)
        ).toBeInTheDocument();
    });

    it("when switching from non-download → download, it sets expiry date and formats", () => {
        const { rerender } = render(<PageInstructions pageState="select" />);
        expect(displayDateTimeMock).not.toHaveBeenCalled();

        rerender(<PageInstructions pageState="download" />);
        expect(displayDateTimeMock).toHaveBeenCalledTimes(1);
        expect(screen.getByText(/MOCK_/)).toBeInTheDocument();
    });
});
