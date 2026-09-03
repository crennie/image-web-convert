import { render, screen } from '@testing-library/react';
import { CosmeticProgress } from './FileProgress';

describe('CosmeticProgress', () => {
    it('describes a waiting indicator without claiming backend conversion stages', () => {
        render(
            <CosmeticProgress
                items={[{ id: 'one', file: new File(['x'], 'photo.png') }]}
                cosmeticPercent={70}
            />,
        );

        expect(screen.getByText('Preparing your download')).toBeInTheDocument();
        expect(
            screen.getByText('Please wait while your request completes.'),
        ).toBeInTheDocument();
        expect(screen.queryByText(/removing metadata/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/converting to/i)).not.toBeInTheDocument();
        expect(screen.getByText(/visual activity indicator: 70%/i)).toBeInTheDocument();
    });
});
