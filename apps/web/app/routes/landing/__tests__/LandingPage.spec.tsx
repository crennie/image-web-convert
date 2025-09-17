import { RenderResult, screen, within } from '@testing-library/react';
import { LandingPage } from '../LandingPage';
import { pageHtmlWithDeps, renderPageWithDeps } from '../../../testUtils';

// Mock UI settings so we can assert dynamic content
const SettingsDisplay = {
    supportedExtensions: ['.jpeg', '.png', '.heic'],
    maxFileSize: '25MB',
    maxTotalSize: '100MB',
    uploadedFileLifespan: '30 minutes',
};

// --- Mocks --- 
// Keep a stable mock reference so we can assert call counts
const clearSessionMock = vi.fn();

vi.mock('@image-web-convert/ui', async (importOriginal) => {
    const actual = await importOriginal<typeof import("@image-web-convert/ui")>();

    return {
        ...actual,
        // Hook under test: expose clearSession so we can assert calls
        useSession: () => ({
            clearSession: clearSessionMock,
            // anything else the hook might return can be stubbed here
        }),
    };
});

// Helpers
function renderPage() {
    return renderPageWithDeps(<LandingPage SettingsDisplay={SettingsDisplay} />);
}

function reRenderPage(component: RenderResult) {
    return component.rerender(pageHtmlWithDeps(<LandingPage SettingsDisplay={SettingsDisplay} />));
}

describe('LandingPage', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders the hero title, subtitle, and description', () => {
        renderPage();

        // Title
        expect(
            screen.getByRole('heading', { level: 1, name: /image web convert/i })
        ).toBeInTheDocument();

        // Subtitle (not a heading level, just text)
        expect(
            screen.getByText(/convert your images for web display/i)
        ).toBeInTheDocument();

        // Description
        expect(
            screen.getByText(/strip metadata, compress, resize, and reformat/i)
        ).toBeInTheDocument();
        expect(
            screen.getByText(/web-ready visuals that boost page performance/i)
        ).toBeInTheDocument();
    });

    it('renders the primary nav button linking to the conversion route', () => {
        renderPage();

        const btn = screen.getByRole('link', { name: /convert files/i });
        expect(btn).toHaveAttribute('href', '/conversion');
    });

    it('shows the Conversion Process section with three steps', () => {
        renderPage();

        expect(
            screen.getByRole('heading', { level: 2, name: /conversion process/i })
        ).toBeInTheDocument();

        // Step headings
        expect(
            screen.getByRole('heading', { level: 3, name: /step 1/i })
        ).toBeInTheDocument();
        expect(
            screen.getByRole('heading', { level: 3, name: /step 2/i })
        ).toBeInTheDocument();
        expect(
            screen.getByRole('heading', { level: 3, name: /step 3/i })
        ).toBeInTheDocument();
    });

    it('renders the dynamic list of supported extensions and limits from UI_SETTINGS_DISPLAY', () => {
        renderPage();

        // Find the Step 1 container and search within it
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const step1 = screen.getByRole('heading', { level: 3, name: /step 1/i }).parentElement!;
        expect(step1).not.toBeNull();
        const step1Region = within(step1);

        // Supported extensions (rendered with commas and <em> tags inside)
        const supported = ['.jpeg', '.png', '.heic'];
        supported.forEach(ext => {
            expect(step1Region.getByText(ext, { exact: false })).toBeInTheDocument();
        });

        // Max file size text
        expect(
            step1Region.getByText(/images cannot exceed/i)
        ).toBeInTheDocument();
        expect(step1Region.getByText(/25mb/i)).toBeInTheDocument();

        // Max total size text
        expect(
            step1Region.getByText(/sessions cannot upload more than/i)
        ).toBeInTheDocument();
        expect(step1Region.getByText(/100mb/i)).toBeInTheDocument();
    });

    it('describes the processing steps and the session/expiry behavior', () => {
        renderPage();

        // Step 2 details

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const step2 = screen.getByRole('heading', { level: 3, name: /step 2/i }).parentElement!;
        expect(step2).not.toBeNull();

        const step2Region = within(step2);
        expect(step2Region.getByText(/metadata is removed/i)).toBeInTheDocument();
        expect(step2Region.getByText(/color profile is normalized/i)).toBeInTheDocument();
        expect(step2Region.getByText(/converted into your chosen output/i)).toBeInTheDocument();

        // Step 3 details

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const step3 = screen.getByRole('heading', { level: 3, name: /step 3/i }).parentElement!;
        expect(step3).not.toBeNull();

        const step3Region = within(step3);
        expect(step3Region.getByText(/downloads are only available during your active session/i)).toBeInTheDocument();
        expect(step3Region.getByText(/permanently deleted after about/i)).toBeInTheDocument();
        expect(step3Region.getByText(/30 minutes/i)).toBeInTheDocument();
    });

    it('calls clearSession once on first mount', () => {
        renderPage();

        expect(clearSessionMock).toHaveBeenCalledTimes(1);
        // sanity check: page content still renders
        expect(
            screen.getByRole('heading', { level: 1, name: /image web convert/i })
        ).toBeInTheDocument();
    });

    it('does not call clearSession again on re-render (no unmount)', () => {
        const component = renderPage();
        expect(clearSessionMock).toHaveBeenCalledTimes(1);

        // Re-render with same props (React Testing Library keeps the same tree; no unmount)
        reRenderPage(component);

        expect(clearSessionMock).toHaveBeenCalledTimes(1);
    });

    it('calls clearSession again if the component unmounts and mounts anew', () => {
        const { unmount } = renderPage();
        expect(clearSessionMock).toHaveBeenCalledTimes(1);

        unmount();

        renderPage();

        expect(clearSessionMock).toHaveBeenCalledTimes(2);
    });

});
