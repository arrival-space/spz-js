export declare const SPZ_MAGIC = 1347635022;
/** Version written by `serializeSpz`. Reading supports 1 through {@link SPZ_VERSION_MAX}. */
export declare const SPZ_VERSION = 2;
/** Highest container version this library can read. */
export declare const SPZ_VERSION_MAX = 4;
/**
 * First version that dropped the single gzip stream for a plaintext header plus
 * per-attribute ZSTD streams described by a table of contents.
 */
export declare const SPZ_VERSION_ZSTD = 4;
export declare const FLAG_ANTIALIASED = 1;
/** v4: extension records sit between the header and the table of contents. */
export declare const FLAG_HAS_EXTENSIONS = 2;
export declare const COLOR_SCALE = 0.15;
export declare const SH_C0 = 0.28209479177387814;
export declare function degreeForDim(dim: number): number;
export declare function dimForDegree(degree: number): number;
