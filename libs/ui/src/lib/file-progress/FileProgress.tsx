import { useEffect, useState } from "react";
import { FileItem } from "../files/FileListItem";
import { FaCheck } from "react-icons/fa";
import { Spinner } from "../Spinner";

const DEFAULT_PROGRESS_STEPS: ProgressStepType[] = [{
    name: 'Processing files',
    status: 'pending',
}, {
    name: 'Removing metadata',
    status: 'pending',
}, {
    name: 'Standardizing colour space',
    status: 'pending',
}, {
    name: 'Converting to webp',
    status: 'pending',
}, {
    name: 'Finalizing conversion',
    status: 'pending',
}];

type ProgressStepStatus = 'pending' | 'loading' | 'complete';
type ProgressStepType = {
    name: string;
    status: ProgressStepStatus;
}

function ProgressStep(step: ProgressStepType) {
    return <div className="flex items-center justify-between">
        <span>{step.name}</span>
        {step.status === 'loading' ? (
            <Spinner />
        ) : step.status === 'complete' ? (
            <FaCheck className="size-6 text-green-500" />
        ) : null}
    </div>
}

function ProgressSteps({ steps }: { steps: ProgressStepType[] }) {
    return (
        <div className="">
            {steps.map((step, i) => <ProgressStep key={i} {...step} />)}
        </div>
    )
}

interface FileProgressProps {
    items: FileItem[];
    progress: number;
}

export function FileProgress({ items, progress }: FileProgressProps) {
    const [steps, setSteps] = useState(DEFAULT_PROGRESS_STEPS);

    // TODO: Implement some polling or server-side events for uploads
    useEffect(() => {
        setSteps(prev => {
            if (!prev?.length) return prev;

            const N = prev.length;
            const p = Math.max(0, Math.min(100, progress ?? 0));

            // Even if progress is complete, leave last item as pending to avoid
            // stale-looking ui for the user
            if (p >= 100) return prev.map((s, i) => i === prev.length - 1 ? ({ ...s })
                : ({ ...s, status: 'complete' }));

            const completed = Math.floor((p * N) / 100);
            return prev.map((s, i) => {
                const status = i < completed ? 'complete'
                    : i === completed ? 'loading' : 'pending';
                return { ...s, status };
            });
        });
    }, [progress]);

    return (
        <div id="file-upload-progress" className="flex max-w-3xl mt-10">
            <div className="grid grid-cols-2 w-full">
                <div className="pr-2 text-lg">
                    <h2 className="text-lg font-bold">Converting Files</h2>
                    {items.map((item, i) => (
                        <div key={i} className="truncate">{item.file.name}</div>
                    ))}
                </div>
                <div className="min-w-fit mx-2 text-lg">
                    <h2 className="text-lg font-bold">Progress</h2>
                    <ProgressSteps steps={steps} />
                </div>
            </div>
        </div>
    )
}

export default FileProgress;
