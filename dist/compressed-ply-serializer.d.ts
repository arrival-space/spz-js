import { GaussianCloud } from './types.js';
/**
 * Serialize a GaussianCloud to a compressed PLY file as used by the PlayCanvas engine.
 *
 * @param data - The GaussianCloud to serialize.
 * @returns The serialized PLY file as an ArrayBuffer.
 */
export declare function serializeCompressedPly(data: GaussianCloud): Uint8Array;
