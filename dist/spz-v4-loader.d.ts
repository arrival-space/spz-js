import { PackedGaussians } from './types.js';
export interface SpzV4Header {
    magic: number;
    version: number;
    numPoints: number;
    shDegree: number;
    fractionalBits: number;
    flags: number;
    numStreams: number;
    tocByteOffset: number;
}
/**
 * Read the plaintext v4 header, or null if this is not an uncompressed v4
 * container (a gzipped v1-3 file, or something else entirely).
 */
export declare function readSpzV4Header(buffer: ArrayBufferLike): SpzV4Header | null;
/**
 * Parse a v4 container into the same {@link PackedGaussians} shape the gzip-based
 * versions produce.
 *
 * SH degree 4 (24 coefficients per channel) exists in v4 but has no
 * representation in this library's GaussianCloud, which tops out at degree 3.
 * Such a file is read at degree 3: the first 15 coefficients of each channel are
 * kept and the rest dropped, rather than failing the load outright.
 */
export declare function deserializePackedGaussiansV4(buffer: ArrayBufferLike): PackedGaussians | null;
