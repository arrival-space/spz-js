export const SPZ_MAGIC = 0x5053474e; // NGSP = Niantic gaussian splat

/** Version written by `serializeSpz`. Reading supports 1 through {@link SPZ_VERSION_MAX}. */
export const SPZ_VERSION = 2;

/** Highest container version this library can read. */
export const SPZ_VERSION_MAX = 4;

/**
 * First version that dropped the single gzip stream for a plaintext header plus
 * per-attribute ZSTD streams described by a table of contents.
 */
export const SPZ_VERSION_ZSTD = 4;

export const FLAG_ANTIALIASED = 0x1;
/** v4: extension records sit between the header and the table of contents. */
export const FLAG_HAS_EXTENSIONS = 0x2;

export const COLOR_SCALE = 0.15;

export const SH_C0 = 0.28209479177387814;

export function degreeForDim(dim: number): number {
    if (dim < 3) return 0;
    if (dim < 8) return 1;
    if (dim < 15) return 2;
    return 3;
}

export function dimForDegree(degree: number): number {
    switch (degree) {
        case 0: return 0;
        case 1: return 3;
        case 2: return 8;
        case 3: return 15;
        default:
            console.error(`[SPZ: ERROR] Unsupported SH degree: ${degree}`);
            return 0;
    }
}
