import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LandingPage } from '../../app/routes/landing';
import { MemoryRouter } from 'react-router';

describe('Landing Page render', () => {
    it('renders content', () => {
        render(
            <MemoryRouter>
                <LandingPage />
            </MemoryRouter>
        );
        const h1 = screen.getByRole('heading', { level: 1 });
        expect(within(h1).getByText(/Image Web Convert/i));
    })
});
