import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { NavButton } from './NavButton';

// Spy on getButtonStyles so we can assert what NavButton passes in
import * as ButtonModule from './Button';

describe('NavButton', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    function renderWithRouter(ui: React.ReactNode, route = '/') {
        return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);
    }

    it('renders a link with accessible name from children', () => {
        renderWithRouter(<NavButton href="conversion">Convert Files</NavButton>);
        const link = screen.getByRole('link', { name: /convert files/i });
        expect(link).toBeInTheDocument();
    });

    it('resolves relative href to absolute URL at the root', () => {
        renderWithRouter(<NavButton href="conversion">Go</NavButton>, '/');
        const link = screen.getByRole('link', { name: /go/i });
        expect(link).toHaveAttribute('href', '/conversion'); // exact at root
    });

    it('resolves relative href relative to the current route', () => {
        render(
            <MemoryRouter initialEntries={['/account']}>
                <Routes>
                    {/* give the Link a route context at /account */}
                    <Route
                        path="/account"
                        element={<NavButton href="conversion">Go</NavButton>}
                    />
                </Routes>
            </MemoryRouter>
        );

        const link = screen.getByRole('link', { name: /go/i });
        expect(link).toHaveAttribute('href', '/account/conversion');
    });

    it('calls getButtonStyles with provided variant and className, and applies the returned classes', () => {
        const spy = vi.spyOn(ButtonModule, 'getButtonStyles').mockReturnValue('computed-classes');
        renderWithRouter(
            <NavButton href="conversion" variant="secondary" className="custom">
                Convert
            </NavButton>
        );
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith({ variant: 'secondary', className: 'custom' });

        const link = screen.getByRole('link', { name: /convert/i });
        expect(link.className).toMatch(/computed-classes/);
    });

    it('forwards the ref to the underlying anchor element', () => {
        const ref = React.createRef<HTMLAnchorElement>();
        renderWithRouter(
            <NavButton href="conversion" ref={ref}>
                Ref Test
            </NavButton>
        );
        expect(ref.current).toBeInstanceOf(HTMLAnchorElement);
        expect(ref.current?.tagName).toBe('A');
    });

    it('passes through arbitrary anchor attributes (target, rel, aria-label, data-*)', () => {
        renderWithRouter(
            <NavButton
                href="conversion"
                target="_blank"
                rel="noopener"
                aria-label="convert link"
                data-test="nav"
            >
                Convert
            </NavButton>
        );
        const link = screen.getByRole('link', { name: /convert/i });
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener');
        expect(link).toHaveAttribute('aria-label', 'convert link');
        expect(link).toHaveAttribute('data-test', 'nav');
    });

    it('does not leak a "to" or "variant" attribute into the rendered <a>', () => {
        renderWithRouter(
            <NavButton href="conversion" variant="primary">
                Convert
            </NavButton>
        );
        const link = screen.getByRole('link', { name: /convert/i });

        // Link's "to" is consumed; the DOM anchor should have "href" only.
        expect(link).not.toHaveAttribute('to');

        // "variant" is used only for class computation; should not be on the DOM node.
        expect(link).not.toHaveAttribute('variant');
    });
});
