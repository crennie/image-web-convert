import ConversionPage from "./components/ConversionPage";

export type ConversionState = 'select' | 'upload' | 'upload_complete' | 'upload_error' | 'download';

function Conversion() {
    return <ConversionPage />
}

export default Conversion;
