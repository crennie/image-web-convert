import { render, screen } from '@testing-library/react';
import { ErrorBoundary, meta, links } from './root';

describe('root.tsx', () => {
    it('provides a page title', () => {
        const args = {
            data: undefined,
            loaderData: {},
            params: {},
            location: {
                pathname: '/',
                search: '',
                hash: '',
                state: null,
                key: 'test',
            },
            matches: [],
        } as Parameters<typeof meta>[0];

        expect(meta(args)).toEqual(
            expect.arrayContaining([{ title: 'Image Web Converter' }]),
        );
    });

    it('loads only same-origin icon links', () => {
        expect(links()).toEqual([
            { rel: 'icon', href: '/favicon.ico', sizes: '16x16 32x32 48x48' },
            { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
        ]);
    });

    it('hides application error details', () => {
        const error = new Error('private token and path');
        error.stack = 'private stack';
        render(<ErrorBoundary error={error} />);
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Something went wrong',
        );
        expect(screen.queryByText(/private/)).not.toBeInTheDocument();
    });

    it('hides route error data on a missing page', () => {
        render(
            <ErrorBoundary
                error={{
                    status: 404,
                    statusText: 'private status text',
                    data: 'private route data',
                    internal: false,
                }}
            />,
        );
        expect(screen.getByRole('alert')).toHaveTextContent('Page not found');
        expect(screen.queryByText(/private/)).not.toBeInTheDocument();
    });
});
