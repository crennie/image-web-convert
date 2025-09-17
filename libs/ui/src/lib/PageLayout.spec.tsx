import { render, screen } from '@testing-library/react';
import { PageLayout } from './PageLayout';

describe('PageLayout', () => {
    it('renders a main landmark', () => {
        render(
            <PageLayout>
                <p>_content_</p>
            </PageLayout>
        );
        // <main> has implicit role="main"
        expect(screen.getByRole('main')).toBeInTheDocument();
        expect(screen.getByText('_content_')).toBeInTheDocument();
    });

    it('merges custom className', () => {
        render(<PageLayout className="custom-page">x</PageLayout>);
        const main = screen.getByRole('main');
        expect(main.className).toMatch(/custom-page/);
    });
});
