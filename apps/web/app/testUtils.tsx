import { SessionProvider } from '@image-web-convert/ui';
import { render } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';

export function pageHtmlWithDeps(children: ReactNode) {
    return <MemoryRouter initialEntries={['/']} >
        <SessionProvider>
            {children}
        </SessionProvider>
    </MemoryRouter>
}

export function renderPageWithDeps(children: ReactNode) {
    return render(pageHtmlWithDeps(children));
}
