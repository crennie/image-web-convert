import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Link, RouterProvider } from 'react-router';
import { BatchNavigationGuard } from '../components/BatchNavigationGuard';

it.each([true, false])(
    'confirms route navigation for active=%s and only leaves after confirmation',
    async (active) => {
        const leave = vi.fn();
        const router = createMemoryRouter([
            {
                path: '/',
                element: (
                    <>
                        <BatchNavigationGuard active={active} onLeave={leave} />
                        <Link to="/away">Home</Link>
                    </>
                ),
            },
            { path: '/away', element: <h1>Home page</h1> },
        ]);
        const { unmount } = render(<RouterProvider router={router} />);
        const unload = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(unload);
        expect(unload.defaultPrevented).toBe(true);
        fireEvent.click(screen.getByRole('link', { name: 'Home' }));
        expect(await screen.findByRole('dialog')).toHaveAccessibleName(
            active ? 'Leave this conversion?' : 'Leave these results?',
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'Stay on this batch' }),
        );
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(leave).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('link', { name: 'Home' }));
        fireEvent.click(
            await screen.findByRole('button', {
                name: active ? 'Leave conversion' : 'Leave results',
            }),
        );
        await screen.findByRole('heading', { name: 'Home page' });
        expect(leave).toHaveBeenCalledOnce();
        unmount();
        const after = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(after);
        expect(after.defaultPrevented).toBe(false);
    },
);

it('dismisses a restart warning with Escape and requires confirmation to restart', async () => {
    const restart = vi.fn();
    render(<BatchNavigationGuard active={false} onNewBatch={restart} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start new batch' }));
    fireEvent(
        screen.getByRole('dialog'),
        new Event('cancel', { cancelable: true }),
    );
    await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(restart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start new batch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave results' }));
    expect(restart).toHaveBeenCalledOnce();
});
