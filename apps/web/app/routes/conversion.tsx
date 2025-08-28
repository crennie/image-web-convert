import { FileUpload, PageLayout } from '@image-web-convert/ui';

export function ConversionPage() {
    return (
        <PageLayout>
            <div className="mt-2 flex flex-col gap-4">
                {/* Add a row for instructions  */}
                <div className="min-h-5">

                </div>

                <div className="">
                    <FileUpload />
                </div>
            </div>
        </PageLayout>
    );
}

export default ConversionPage;
