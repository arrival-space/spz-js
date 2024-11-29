import { GaussianCloud, PackedGaussians } from './types.js';
export declare function packGaussians(g: GaussianCloud): PackedGaussians;
export declare function loadSpz(buffer: Uint8Array): Promise<GaussianCloud>;
