import { ImageFormat } from './common.js';

describe('schemas smoke', () => {
    it('has ImageFormat defined', () => {
        expect(Object.keys(ImageFormat.def.entries).length).greaterThan(0);
    });
});
