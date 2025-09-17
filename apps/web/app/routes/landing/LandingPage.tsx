'use client';

import { NavButton, PageLayout, useSession } from '@image-web-convert/ui';
import { UI_SETTINGS_DISPLAY, UiSettingsDisplay } from '../../ui.config';
import { useEffect } from 'react';

interface LandingPageProps {
    SettingsDisplay?: UiSettingsDisplay;
}
export function LandingPage({ SettingsDisplay = UI_SETTINGS_DISPLAY }: LandingPageProps) {
    const { clearSession } = useSession();

    // On page mount, ensure any existing session is cleared
    useEffect(() => {
        clearSession();
    }, [clearSession]);

    return (
        <PageLayout>
            <div className="flex flex-col gap-10 items-center justify-center">
                <div className="mt-20 max-w-2xl text-center">
                    <h1 className="font-bold text-3xl">Image Web Convert</h1>
                    <div className="mt-1 text-xl">Convert Your Images For Web Display</div>
                    <div className="mt-4 leading-relaxed text-lg">
                        Strip metadata, compress, resize, and reformat your pictures with one click. Deliver web-ready visuals that boost page performance with streamlined image anonymization and conversion.
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
                        <div className="w-full md:w-1/3">
                            <h3 className="font-semibold text-lg underline">Step 1</h3>
                            <div>
                                Select your image files and click <strong>Start</strong>.
                                <ul className="list-disc pl-4">
                                    <li>Supported images: <br />{SettingsDisplay.supportedExtensions
                                        .map((ext, i) => <span key={i}>
                                            {i !== 0 ? ', ' : ''}<em>{ext}</em>
                                        </span>)}
                                    </li>
                                    <li>Images cannot exceed {SettingsDisplay.maxFileSize}</li>
                                    <li>Sessions cannot upload more than {SettingsDisplay.maxTotalSize} of files at a time.</li>
                                </ul>
                            </div>
                        </div>
                        <div className="w-full md:w-1/3">
                            <h3 className="font-semibold text-lg underline">Step 2</h3>
                            <div>
                                Your images are uploaded and automatically processed:
                                <ul className="list-disc pl-4">
                                    <li>All personal and identifying metadata is removed.</li>
                                    <li>The color profile is normalized for consistent web display.</li>
                                    <li>Files are converted into your chosen output format(s).</li>
                                </ul>
                            </div>

                        </div>
                        <div className="w-full md:w-1/3">
                            <h3 className="font-semibold text-lg underline">Step 3</h3>
                            <div>
                                Download your converted images directly.
                                <ul className="list-disc pl-4">
                                    <li><strong>Important:</strong>&nbsp;Downloads are only available during your active session. If you leave, you'll need to re-upload and convert again.</li>
                                    <li>Temporary server copies used during processing are permanently deleted after about {SettingsDisplay.uploadedFileLifespan}.</li>
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
