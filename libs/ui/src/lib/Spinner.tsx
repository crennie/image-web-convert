import { cn } from "./utils";

interface SpinnerProps {
    className?: string;
    label?: string;
};

export function Spinner({ className = "size-6 text-gray-400", label = "Loading" }: SpinnerProps) {
    return (
        <span role="status" aria-label={label} className="inline-flex items-center">
            <span
                className={cn(`inline-block shrink-0 rounded-full border-[3px] border-current border-t-transparent motion-safe:animate-spin`, className || '')}
            />
            <span className="sr-only">{label}</span>
        </span>
    );
}

export default Spinner;
