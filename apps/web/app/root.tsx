import {
    Links,
    Meta,
    Outlet,
    Scripts,
    ScrollRestoration,
    type MetaFunction,
    type LinksFunction,
    isRouteErrorResponse,
} from 'react-router';
import { Nav, SessionProvider } from '@image-web-convert/ui';
import '../styles.css';
import { ParticleBackground } from './components/ParticleBackground';

export function ErrorBoundary({ error }: { error: unknown }) {
    const notFound = isRouteErrorResponse(error) && error.status === 404;
    return (
        <main role="alert" className="mx-auto max-w-2xl px-6 py-16">
            <h1>{notFound ? 'Page not found' : 'Something went wrong'}</h1>
            <p>
                {notFound
                    ? 'Check the address and try again.'
                    : 'Please try again later.'}
            </p>
        </main>
    );
}

export const meta: MetaFunction = () => [
    {
        title: 'Image Web Converter',
    },
];

export const links: LinksFunction = () => [
    { rel: 'icon', href: '/favicon.ico', sizes: '16x16 32x32 48x48' },
    { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
];

export function Layout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1"
                />
                <Meta />
                <Links />
            </head>
            <body className="body-background text-foreground min-h-screen overscroll-none">
                <ParticleBackground />
                <div className="site-content pt-[65px]">
                    <Nav className="h-[65px]" />
                    <SessionProvider>{children}</SessionProvider>
                </div>
                <ScrollRestoration />
                <Scripts />
            </body>
        </html>
    );
}

export default function App() {
    return <Outlet />;
}
