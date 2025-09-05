import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileUploadConfig } from "../file-upload.config";

export type Rejection = { file: File; reason: string };

export type UseDropzoneProps = {
    config?: FileUploadConfig;
    multiple?: boolean;
    disabled?: boolean;
    enablePaste?: boolean;
    onSelectFiles?: (files: File[]) => void;
};

export type UseDropzoneResponse = {
    isDragActive: boolean;
    // Pass props to drag & drop container 
    rootProps: {
        onDragEnter: (e: React.DragEvent) => void;
        onDragOver: (e: React.DragEvent) => void;
        onDragLeave: (e: React.DragEvent) => void;
        onDrop: (e: React.DragEvent) => void;
        role: "button";
        tabIndex: 0;
        onKeyDown: (e: React.KeyboardEvent) => void;
        "aria-disabled": boolean;
    };
    // Pass props to input file container 
    inputProps: {
        ref: React.RefObject<HTMLInputElement | null>;
        type: "file";
        multiple?: boolean;
        accept?: string;
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
        tabIndex: -1;
        style: React.CSSProperties;
        "aria-hidden": true;
    };
    open: () => void;
};

export function useDropzone(opts: UseDropzoneProps = {}): UseDropzoneResponse {
    const {
        config: { accept } = {},
        multiple = true,
        disabled = false,
        enablePaste = false,
        onSelectFiles,
    } = opts;

    const [isDragActive, setDragActive] = useState(false);
    const dragDepth = useRef(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const acceptAttr = useMemo(() => {
        if (Array.isArray(accept) && accept.length) return accept.join(",");
        else if (typeof accept === 'string') return accept
        return undefined;
    }, [accept]);

    const extractFilesFromDataTransfer = (dt: DataTransfer | null): File[] => {
        if (!dt) return [];
        // Basic: items → files (ignore directories for v1)
        if (dt.items && dt.items.length) {
            const files: File[] = [];
            for (const item of Array.from(dt.items)) {
                if (item.kind === "file") {
                    const f = item.getAsFile();
                    if (f) files.push(f);
                }
            }
            return files;
        }
        return Array.from(dt.files || []);
    };

    // ---- Event handlers (Drag & Drop) ----
    const handleDragEnter = useCallback((e: React.DragEvent) => {
        if (disabled) return;
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current += 1;
        setDragActive(true);
    }, [disabled]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        if (disabled) return;
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault(); // allow drop
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
    }, [disabled]);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        if (disabled) return;
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragActive(false);
    }, [disabled]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        if (disabled) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current = 0;
        setDragActive(false);

        const files = extractFilesFromDataTransfer(e.dataTransfer);
        onSelectFiles?.(files);
    }, [disabled, onSelectFiles]);

    // ---- Input (browse) ----
    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (disabled) return;
        const files = e.target.files ? Array.from(e.target.files) : [];
        // reset input so the same file can be selected again later
        e.target.value = "";
        onSelectFiles?.(files);
    }, [disabled, onSelectFiles]);

    const open = useCallback(() => {
        if (!disabled) inputRef.current?.click();
    }, [disabled]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
        }
    }, [disabled, open]);

    // ---- Paste (optional) ----
    useEffect(() => {
        if (!enablePaste || disabled) return;
        const onPaste = (e: ClipboardEvent) => {
            const files = e.clipboardData ? Array.from(e.clipboardData.files) : [];
            if (!files.length) return;
            onSelectFiles?.(files);
        };
        document.addEventListener("paste", onPaste);
        return () => document.removeEventListener("paste", onPaste);
    }, [enablePaste, disabled, onSelectFiles]);

    // ---- Exposed props ----
    const rootProps: UseDropzoneResponse["rootProps"] = {
        onDragEnter: handleDragEnter,
        onDragOver: handleDragOver,
        onDragLeave: handleDragLeave,
        onDrop: handleDrop,
        role: "button",
        tabIndex: 0,
        onKeyDown: handleKeyDown,
        "aria-disabled": disabled,
    };

    const inputProps: UseDropzoneResponse["inputProps"] = {
        ref: inputRef,
        type: "file",
        multiple,
        accept: acceptAttr,
        onChange: handleChange,
        tabIndex: -1,
        style: { display: "none" },
        "aria-hidden": true,
    };

    return { isDragActive, rootProps, inputProps, open };
}
