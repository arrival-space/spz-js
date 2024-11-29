import { PackedGaussians, GaussianCloud } from './types.js';
export declare function serializePackedGaussians(packed: PackedGaussians): Promise<Uint8Array>;
export declare function serializeSpz(g: GaussianCloud): Promise<Uint8Array>;
