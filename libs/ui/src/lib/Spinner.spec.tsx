import { render, screen } from '@testing-library/react';
import { Spinner } from './Spinner';

describe('Spinner', () => {
    it('renders a status element with default accessible label', () => {
        render(<Spinner />);
        const status = screen.getByRole('status', { name: /loading/i });
        expect(status).toBeInTheDocument();
    });

    it('sets aria-label and sr-only text from the label prop', () => {
        render(<Spinner label="Converting images" />);
        const status = screen.getByRole('status', { name: /converting images/i });
        expect(status).toBeInTheDocument();
        // sr-only label should mirror the aria-label
        expect(screen.getByText(/converting images/i)).toBeInTheDocument();
    });

    it('renders the spinner visual with spin + border classes', () => {
        render(<Spinner />);
        const status = screen.getByRole('status', { name: /loading/i });
        // first child span is the spinning visual
        const visual = status.querySelector('span:nth-child(1)') as HTMLSpanElement;
        expect(visual).toBeTruthy();
        const cls = visual.className;
        expect(cls).toMatch(/inline-block/);
        expect(cls).toMatch(/rounded-full/);
        expect(cls).toMatch(/border-\[3px\]/);
        expect(cls).toMatch(/border-current/);
        expect(cls).toMatch(/border-t-transparent/);
        expect(cls).toMatch(/motion-safe:animate-spin/);
    });

    it('applies default size/color classes and merges custom className', () => {
        render(<Spinner className="size-8 text-blue-500 custom-x" />);
        const status = screen.getByRole('status', { name: /loading/i });
        const visual = status.querySelector('span:nth-child(1)') as HTMLSpanElement;
        const cls = visual.className;
        // custom classes present
        expect(cls).toMatch(/size-8/);
        expect(cls).toMatch(/text-blue-500/);
        expect(cls).toMatch(/custom-x/);
    });

});
