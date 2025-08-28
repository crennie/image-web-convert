import { NavButton, PageLayout } from '@image-web-convert/ui';

export function LandingPage() {
    return (
        <PageLayout>
            <div className="flex flex-col gap-10 items-center justify-center">
                <div className="mt-20 max-w-2xl text-center">
                    <h1 className="font-bold text-3xl">Image Web Convert</h1>
                    <div className="mt-1 text-xl">Convert Your Images For Web Display</div>
                    <div className="mt-4 leading-relaxed text-lg">
                        Add files to convert lorem ipsum Add files to convert lorem ipsumAdd files to convert lorem ipsumAdd files to convert lorem ipsumAdd files to convert lorem ipsumAdd files to convert lorem ipsumAdd files to convert lorem ipsumAdd files to convert lorem ipsumAdd files to convert lorem ipsumAdd files to convert lorem ipsumAdd files to convert lorem ipsum
                    </div>
                </div>
                <div className="">
                    <NavButton href="conversion" variant="primary">
                        Convert Files
                    </NavButton>
                </div>

                <div className="mt-6 w-full max-w-6xl flex flex-col gap-4">
                    <h2 className="font-bold text-xl">Conversion Process</h2>
                    <div className="flex flex-col md:flex-row gap-6 md:gap-12">
                        <div className="w-1/3">
                            <h3 className="font-semibold text-lg underline">Step 1</h3>
                            <div>
                                Select your image files to upload and click "Start".
                                <ul className="list-disc pl-4">
                                    <li>Supported images include .jpeg, .png, .heic (iphone), ...</li>
                                    <li>Images cannot exceed XYmb</li>
                                </ul>
                            </div>
                        </div>
                        <div className="w-1/3">
                            <h3 className="font-semibold text-lg underline">Step 2</h3>
                            <div>
                                Images are uploaded and conversion begins. This process:
                                <ul className="list-disc pl-4">
                                    <li>Removes personal and identifying information from the image metadata.</li>
                                    <li>Normalizes the color space of the image for interoperable web display.</li>
                                    <li>Outputs the converted image to your selected output type(s).</li>
                                </ul>
                            </div>

                        </div>
                        <div className="w-1/3">
                            <h3 className="font-semibold text-lg underline">Step 3</h3>
                            <div>
                                Your converted images are ready to be downloaded.
                                <ul className="list-disc pl-4">
                                    <li>BE AWARE: Once you leave your active session you will no longer be able to download your images, and you will have to convert them again in a new session.</li>
                                    <li>Any intermediate copies of your images saved on the server during processing will be permanently deleted after XY minutes.</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </PageLayout>
    );
}

export default LandingPage;
