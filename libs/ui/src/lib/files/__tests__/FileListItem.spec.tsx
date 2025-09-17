import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { FileListItem, type FileItem } from '../FileListItem';

// Util for creating mock items
function makeItem(id: string, name = `file-${id}.jpg`, type = 'image/jpeg'): FileItem {
    const file = new File([new Uint8Array([1, 2, 3])], name, { type });
    return { id, file, previewUrl: 'about:blank' };
}

describe('FileListItem', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders an image preview and filename', () => {
        const item = makeItem('a', 'cat.jpg');
        render(<FileListItem item={item} />);

        const img = screen.getByRole('img', { name: /cat\.jpg/i });
        expect(img).toBeInTheDocument();

        // Filename label at bottom
        expect(screen.getByText('cat.jpg')).toBeInTheDocument();
    });

    it('falls back to "No preview available" if the image errors', () => {
        const item = makeItem('a', 'broken.jpg');
        render(<FileListItem item={item} />);

        const img = screen.getByRole('img', { name: /broken\.jpg/i });

        // simulate onError
        fireEvent.error(img);

        expect(screen.getByText(/no preview available/i)).toBeInTheDocument();
    });

    it('calls onRemove(item) when the remove button is clicked (when showRemove=true)', async () => {
        const user = userEvent.setup();
        const item = makeItem('a', 'removable.jpg');
        const onRemove = vi.fn();

        const { getByRole } = render(<FileListItem item={item} showRemove onRemove={onRemove} />);

        // Remove button renders an "X" icon (FaTimes) inside the button
        // const buttons = screen.getAllByRole('button');
        // expect(buttons.length).toBe(1);
        // console.log(buttons);

        await user.click(getByRole('button'));

        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(onRemove).toHaveBeenCalledWith(item);
    });

    it('calls onDownload(item) when the download button is clicked (showDownload=true)', async () => {
        const user = userEvent.setup();
        const item = makeItem('a', 'dl.jpg');
        const onDownload = vi.fn().mockResolvedValue(undefined);

        render(<FileListItem item={item} showDownload onDownload={onDownload} />);

        // The download button contains the download icon (FaDownload) initially
        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBe(1);

        await user.click(buttons[0]);

        expect(onDownload).toHaveBeenCalledTimes(1);
        expect(onDownload).toHaveBeenCalledWith(item);
    });

    it('shows a spinner while download is in progress and prevents re-entry', async () => {
        const user = userEvent.setup();
        const item = makeItem('a', 'dl.jpg');

        // Promise we control to simulate a long download
        let resolve!: () => void;
        const p = new Promise<void>(r => (resolve = r));
        const onDownload = vi.fn().mockReturnValue(p);

        const { getByRole } = render(<FileListItem item={item} showDownload onDownload={onDownload} />);

        // First click -> starts download, shows spinner
        await user.click(getByRole('button'));
        expect(onDownload).toHaveBeenCalledTimes(1);

        expect(screen.getByRole('status')).toBeInTheDocument();

        // Second click while loading should be ignored (debounced)
        await user.click(getByRole('button'));
        expect(onDownload).toHaveBeenCalledTimes(1);

        // Finish the promise -> spinner should go away after state settles
        await act(async () => {
            resolve();
            await Promise.resolve(); // microtask flush
        });

        await waitFor(() => {
            expect(screen.queryByRole('status')).not.toBeInTheDocument();
        });
    });

    it('clicking the card container triggers download when enabled (cardClickProps)', async () => {
        const user = userEvent.setup();
        const item = makeItem('a', 'card.jpg');
        const onDownload = vi.fn().mockResolvedValue(undefined);

        const { container } = render(
            <FileListItem item={item} showDownload onDownload={onDownload} />
        );

        // The clickable container is the root of FileCardLayout; query by class pattern
        const clickable = container.querySelector('.bg-muted') as HTMLElement;
        expect(clickable).toBeInTheDocument();

        // Root click should call the same handler (debounced by loader internally)
        await user.click(clickable);
        expect(onDownload).toHaveBeenCalledTimes(1);
    });

    it('adds pointer cursor when clickable (showDownload && onDownload)', () => {
        const item = makeItem('a');
        const { container: c1 } = render(<FileListItem item={item} />);
        const box1 = c1.querySelector('.bg-muted') as HTMLElement;
        expect(box1.className).not.toMatch(/cursor-pointer/);

        const { container: c2 } = render(
            <FileListItem item={item} showDownload onDownload={vi.fn()} />
        );
        const box2 = c2.querySelector('.bg-muted') as HTMLElement;
        expect(box2.className).toMatch(/cursor-pointer/);
    });
});
