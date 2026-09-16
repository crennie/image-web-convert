import ConversionOperationPanel from './components/ConversionOperationPanel';

export type ConversionState =
    | 'select'
    | 'upload'
    | 'upload_complete'
    | 'upload_error'
    | 'download';

function Conversion() {
    return <ConversionOperationPanel />;
}

export default Conversion;
