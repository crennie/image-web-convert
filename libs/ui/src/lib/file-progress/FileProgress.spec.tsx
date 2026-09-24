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

        expect(
            screen.getByText('Waiting for your request'),
        ).toBeInTheDocument();
        expect(
            screen.getByText('Please wait while your request completes.'),
        ).toBeInTheDocument();
        expect(
            screen.queryByText(/removing metadata/i),
        ).not.toBeInTheDocument();
        expect(screen.queryByText(/converting to/i)).not.toBeInTheDocument();
        expect(
            screen.getByText(/does not measure upload or conversion progress/i),
        ).toBeInTheDocument();
        expect(screen.queryByText(/70%/)).not.toBeInTheDocument();
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
});
