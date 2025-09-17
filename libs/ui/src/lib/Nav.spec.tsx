import { render, screen } from '@testing-library/react';
import { Nav } from './Nav';
import { MemoryRouter } from 'react-router';

describe('Nav', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function renderNav(props?: any) {
        return render(<MemoryRouter initialEntries={['/']}><Nav {...props} /></MemoryRouter>);
    }
    it('renders a navigation landmark', () => {
        renderNav();
        // <nav> has implicit role="navigation"
        expect(screen.getByRole('navigation')).toBeInTheDocument();
    });

    it('renders a home link with logo and title', () => {
        renderNav();
        const homeLink = screen.getByRole('link', { name: /Home/i });
        expect(homeLink).toBeInTheDocument();
        expect(homeLink).toHaveAttribute('href', '/');

        // Logo image is present with alt text
        const logo = screen.getByAltText(/site logo/i);
        expect(logo).toBeInTheDocument();
    });

    it('applies the expected base navbar classes', () => {
        renderNav();
        const nav = screen.getByRole('navigation');
        // spot-check a few critical classes
        expect(nav.className).toMatch(/fixed/);
        expect(nav.className).toMatch(/top-0/);
        expect(nav.className).toMatch(/w-full/);
    });

    it('merges additional className onto the nav element', () => {
        renderNav({ className: "custom-nav" });
        expect(screen.getByRole('navigation').className).toMatch(/custom-nav/);
    });
});
