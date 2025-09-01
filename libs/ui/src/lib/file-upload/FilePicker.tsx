'use client';

import { ChangeEvent, useCallback, useRef } from "react";
import { FileCardLayout } from "../files/FileCardLayout";
import { FaPlus } from "react-icons/fa";

interface FilePickerProps {
    clearErrors: () => void;
    onFilesPicked: (files: File[]) => void;
    onPreOpen?: () => void;
}

export function FilePicker({ clearErrors, onFilesPicked, onPreOpen }: FilePickerProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const onChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        const files: File[] = [...e.target.files ?? []];
        e.currentTarget.value = ""; // Directly reset input field so browser recognizes same file chosen twice in a row
        onFilesPicked(files);
    }, [onFilesPicked]);

    // Runs right before opening the dialog (mouse or keyboard).
    const handlePreOpen = useCallback(() => onPreOpen?.(), [onPreOpen]);

    // Keyboard: Space/Enter on the label won't always activate the input.
    // We forward it manually and prevent default to avoid scrolling on Space.
    const handleLabelKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLLabelElement>) => {
            if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                handlePreOpen();
                inputRef.current?.click();
            }
        },
        [handlePreOpen]
    );

    return (
        <FileCardLayout>
            <input ref={inputRef} id="file-uploads" name="file-uploads" type="file" multiple={true} onChange={onChange}
                className="hidden" />
            <label tabIndex={0} htmlFor="file-uploads" className="flex flex-col gap-3 items-center justify-center w-full h-full cursor-pointer text-primary"
                onClick={clearErrors}
                onKeyDown={handleLabelKeyDown}
            >
                <span className="text-lg">Add file(s)</span>
                <FaPlus className="size-10" />
            </label>
        </FileCardLayout>
    )
}

export default FilePicker;
