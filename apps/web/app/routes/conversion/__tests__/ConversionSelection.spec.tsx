import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { useFileItems, FILE_UPLOAD_CONFIG } from '@image-web-convert/ui';
import type { OutputMimeType } from '@image-web-convert/schemas';
import { ConversionSelection } from '../components/ConversionSelection';

beforeEach(() => {
    URL.createObjectURL = vi.fn().mockReturnValue('blob:preview');
    URL.revokeObjectURL = vi.fn();
});
function Harness({ disabled = false }: { disabled?: boolean }) {
    const files = useFileItems({
        config: { ...FILE_UPLOAD_CONFIG, accept: ['image/png'] },
    });
    const [mime, setMime] = useState<OutputMimeType>('image/webp');
    return (
        <ConversionSelection
            items={files.items}
            errors={files.selectionErrors}
            onDismissError={files.dismissError}
            onClearErrors={files.clearErrors}
            disabled={disabled}
            outputMime={mime}
            onMime={setMime}
            onAdd={files.addItems}
            onRemove={files.removeItem}
            onSubmit={vi.fn()}
        />
    );
}
const png = () => new File(['image'], 'one.png', { type: 'image/png' });
function choose(container: HTMLElement, files: File[]) {
    fireEvent.change(screen.getByLabelText('Choose images'), {
        target: { files },
    });
}
it('reveals conversion controls only with files and retains format after removing the last file', () => {
    const { container } = render(<Harness />);
    expect(screen.queryByLabelText('Output format')).not.toBeInTheDocument();
    expect(
        screen.queryByRole('button', { name: 'Start conversion' }),
    ).not.toBeInTheDocument();
    choose(container, [png()]);
    fireEvent.change(screen.getByLabelText('Output format'), {
        target: { value: 'image/png' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove one.png' }));
    expect(screen.queryByLabelText('Output format')).not.toBeInTheDocument();
    choose(container, [png()]);
    expect(screen.getByLabelText('Output format')).toHaveValue('image/png');
});
it('falls back on decode failure and handles placeholder failure without preventing conversion', () => {
    const { container } = render(<Harness />);
    choose(container, [png()]);
    fireEvent.error(screen.getByRole('img', { name: 'Preview of one.png' }));
    expect(container.querySelector('img')).toHaveAttribute(
        'src',
        '/image-preview-unavailable.svg',
    );
    const fallback = container.querySelector('img');
    if (!fallback) throw new Error('Missing fallback');
    fireEvent.error(fallback);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
    expect(
        screen.getByRole('button', { name: 'Start conversion' }),
    ).toBeEnabled();
});
it('dismisses errors individually and restores focus to browse after the last', () => {
    const { container } = render(<Harness />);
    choose(container, [new File(['x'], 'bad.txt'), new File(['y'], 'bad.txt')]);
    fireEvent.click(
        screen.getAllByRole('button', { name: /Dismiss error/ })[0],
    );
    expect(
        screen.getAllByRole('button', { name: /Dismiss error/ }),
    ).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Dismiss error/ })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss error/ }));
    expect(
        screen.queryByRole('list', { name: 'Selection errors' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose images' })).toHaveFocus();
});
it('highlights page drags, adds only target drops, and clears feedback', () => {
    render(<Harness />);
    const dataTransfer = { types: ['Files'], files: [png()], dropEffect: '' };
    const zone = screen.getByTestId('selection-dropzone');
    fireEvent.dragEnter(document.body, { dataTransfer });
    expect(zone.className).toContain('ring-2');
    fireEvent.drop(document.body, { dataTransfer });
    expect(screen.queryByText('one.png')).not.toBeInTheDocument();
    fireEvent.dragEnter(zone, { dataTransfer });
    expect(screen.getByText('Release to add images')).toBeInTheDocument();
    fireEvent.drop(zone, { dataTransfer });
    expect(screen.getByText('one.png')).toBeInTheDocument();
    expect(zone.className).not.toContain('ring-2');
});
it('does not accept drops while disabled', () => {
    render(<Harness disabled />);
    fireEvent.drop(screen.getByTestId('selection-dropzone'), {
        dataTransfer: { types: ['Files'], files: [png()] },
    });
    expect(screen.queryByText('one.png')).not.toBeInTheDocument();
});

it('ignores text drops and clears cancelled drag feedback', () => {
    render(<Harness />);
    const zone = screen.getByTestId('selection-dropzone');
    expect(
        fireEvent.drop(zone, {
            dataTransfer: { types: ['text/plain'], files: [] },
        }),
    ).toBe(true);
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'] } });
    fireEvent.dragEnter(screen.getByRole('button', { name: 'Choose images' }), {
        dataTransfer: { types: ['Files'] },
    });
    fireEvent.dragLeave(screen.getByRole('button', { name: 'Choose images' }), {
        dataTransfer: { types: ['Files'] },
    });
    expect(screen.getByText('Release to add images')).toBeInTheDocument();
    fireEvent.blur(window);
    expect(zone.className).not.toContain('ring-2');
    expect(screen.getByText('Drag images here')).toBeInTheDocument();
});

it('clears all errors without removing files and returns focus to browse', () => {
    const { container } = render(<Harness />);
    choose(container, [
        png(),
        new File(['x'], 'bad.txt'),
        new File(['y'], 'other.txt'),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all errors' }));
    expect(
        screen.queryByRole('list', { name: 'Selection errors' }),
    ).not.toBeInTheDocument();
    expect(
        screen.queryByRole('button', { name: 'Clear all errors' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('one.png')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose images' })).toHaveFocus();
    choose(container, [new File(['x'], 'bad.txt')]);
    expect(
        screen.getByRole('list', { name: 'Selection errors' }),
    ).toHaveTextContent('bad.txt');
});

it('keeps keyboard focus predictable when dismissing middle and last errors', () => {
    const { container } = render(<Harness />);
    choose(
        container,
        ['first.txt', 'middle.txt', 'last.txt'].map(
            (name) => new File(['bad'], name),
        ),
    );
    const middle = screen.getByRole('button', {
        name: /Dismiss error: middle.txt/,
    });
    middle.focus();
    fireEvent.click(middle);
    expect(
        screen.getByRole('button', { name: /Dismiss error: last.txt/ }),
    ).toHaveFocus();
    expect(
        screen.queryByRole('button', { name: /Dismiss error: middle.txt/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(
        screen.getByRole('button', { name: /Dismiss error: last.txt/ }),
    );
    expect(
        screen.getByRole('button', { name: /Dismiss error: first.txt/ }),
    ).toHaveFocus();
    fireEvent.click(
        screen.getByRole('button', { name: /Dismiss error: first.txt/ }),
    );
    expect(screen.getByRole('button', { name: 'Choose images' })).toHaveFocus();
    expect(
        screen.queryByRole('button', { name: 'Clear all errors' }),
    ).not.toBeInTheDocument();
});
