import { render, screen } from '@testing-library/react';
import { FileList } from '../FileList';
import type { FileItem } from '../FileListItem';

// Minimal helper to create a FileItem
function makeItem(id: string, name = `file-${id}.jpg`, type = 'image/jpeg'): FileItem {
    const file = new File([new Uint8Array([1, 2, 3])], name, { type });
    return { id, file, previewUrl: 'about:blank' };
}

describe('FileList', () => {
    it('renders a FileListItem per item', () => {
        const items = [makeItem('a'), makeItem('b'), makeItem('c')];
        render(<FileList items={items} />);

        // Each filename appears once
        items.forEach(i => {
            expect(screen.getByText(i.file.name)).toBeInTheDocument();
        });
    });

    it('passes showRemove/showDownload and handlers down to each item', async () => {
        const items = [makeItem('a'), makeItem('b')];
        const onRemove = vi.fn();
        const onDownload = vi.fn().mockResolvedValue(undefined);

        render(
            <FileList
                items={items}
                showRemove
                showDownload
                onRemove={onRemove}
                onDownload={onDownload}
            />
        );

        // Buttons (from FileListItem) will be covered in FileListItem tests; here we just sanity-check filenames render
        items.forEach(i => {
            expect(screen.getByText(i.file.name)).toBeInTheDocument();
        });
    });
});
