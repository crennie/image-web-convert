'use client';

import { useEffect, useState } from "react";
import { FaChevronLeft, FaChevronRight } from "react-icons/fa";
import Button from "../Button";

interface ValidationErrorsProps {
    errors: string[];
}

export function ValidationErrors({ errors }: ValidationErrorsProps) {
    const [displayIndex, setDisplayIndex] = useState(0);

    useEffect(() => {
        setDisplayIndex(0);
    }, [errors])

    if (!errors.length) return;
    const displayError = errors[displayIndex];
    return (
        <div className="flex items-center gap-1 text-destructive">
            <div className="flex shrink-0">
                <div className="mx-auto">{displayIndex + 1} / {errors.length}</div>
            </div>
            {errors.length > 1 ? (
                <div className="flex gap-1 mx-auto">
                    <Button variant="ghost" className="cursor-pointer"
                        onClick={() => setDisplayIndex(prev => (prev - 1 + errors.length) % errors.length)}
                    >
                        <FaChevronLeft className="size-6" />
                    </Button>
                    <Button variant="ghost" className="cursor-pointer"
                        onClick={() => setDisplayIndex(prev => (prev + 1) % errors.length)}
                    >
                        <FaChevronRight className="size-6" />
                    </Button>
                </div>
            ) : null}
            <span>{displayError}</span>
        </div>
    )
}

export default ValidationErrors;
