import { render, screen } from '@testing-library/react';

import Button from './Button';

describe('Button', () => {
    it('should render successfully', () => {
        const { baseElement } = render(<Button>My Button</Button>);
        expect(baseElement).toBeTruthy();

        // Find the button by its role and accessible name (text content)
        const button = screen.getByRole('button', { name: /my button/i });

        // Assert that the button has the expected text content
        expect(button).toBeTruthy();
    });
});
