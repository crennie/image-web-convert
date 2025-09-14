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
import "../styles.css";

export function ErrorBoundary(...args: any[]) {
    console.log(args);
    const error = args[0].error;
    if (isRouteErrorResponse(error)) {
        return (
            <>
                <h1>
                    {error.status} {error.statusText}
                </h1>
                <p>{error.data}</p>
            </>
        );
    } else if (error instanceof Error) {
        return (
            <div>
                <h1>Error</h1>
                <p>{error.message}</p>
                <p>The stack trace is:</p>
                <pre>{error.stack}</pre>
            </div>
        );
    } else {
        return <h1>Unknown Error</h1>;
    }
}

export const meta: MetaFunction = () => [
    {
        title: 'Image Web Converter',
    },
];

export const links: LinksFunction = () => [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
    },
    {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap',
    },
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
                <div className="pt-[65px]">
                    <Nav className="h-[65px]" />
                    <SessionProvider>
                        {children}
                    </SessionProvider>
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
