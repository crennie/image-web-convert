import { render, screen } from '@testing-library/react';
import { FileCardLayout } from '../FileCardLayout';

describe('FileCardLayout', () => {
    it('renders children inside a styled container', () => {
        render(
            <FileCardLayout>
                <span>child</span>
            </FileCardLayout>
        );
        const box = screen.getByText('child').closest('div');
        expect(box).toBeInTheDocument();
        if (!box) return;

        // spot-check core classes
        const cls = box.className;
        expect(cls).toMatch(/relative/);
        expect(cls).toMatch(/aspect-square/);
        expect(cls).toMatch(/border/);
        expect(cls).toMatch(/rounded-2xl/);
    });

    it('merges className prop', () => {
        render(
            <FileCardLayout className="extra-class">
                <span>child</span>
            </FileCardLayout>
        );
        const box = screen.getByText('child').closest('div');
        if (!box) return;

        expect(box.className).toMatch(/extra-class/);
    });

    it('forwards arbitrary HTML div attributes', () => {
        render(
            <FileCardLayout id="card-1" title="card">
                <span>child</span>
            </FileCardLayout>
        );
        const box = screen.getByTitle('card');
        expect(box).toHaveAttribute('id', 'card-1');
    });
});
