'use client';

import { useRef } from "react";
import { displayDateTime } from "@image-web-convert/ui";
import { ConversionState } from "..";
import { UI_SETTINGS_DISPLAY, UPLOADED_FILE_LIFESPAN_MS } from "../../../ui.config";

export function PageInstructions({ pageState }: { pageState: ConversionState }) {
    const expiryTime = useRef<Date | null>(null);

    if (!expiryTime.current && pageState === 'download') {
        expiryTime.current = new Date(new Date().getTime() + UPLOADED_FILE_LIFESPAN_MS);
    }

    const expiryDisplay = expiryTime.current ? `${displayDateTime(expiryTime.current)}`
        : `in ${UI_SETTINGS_DISPLAY.uploadedFileLifespan}`

    if (pageState === 'select') return <>
        Add images to convert. File type and size are checked instantly. You can remove files at any time before starting the conversion.
    </>

    if (pageState === 'upload' || pageState === 'upload_complete') return <>
        Converting your files... Please keep this page open. Be sure to download your images once the conversion is complete.
    </>

    // TODO: Add dynamic expiry time, or make expiry time configurable?  Should it countdown?
    if (pageState === 'download') return <>
        Your converted files are ready to download. They'll remain available until your session expires: <strong>{expiryDisplay}</strong>. Be sure to save them to keep a copy.
    </>

    return null;
}