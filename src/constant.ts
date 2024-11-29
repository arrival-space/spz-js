export const SPZ_MAGIC = 0x5053474e; // NGSP = Niantic gaussian splat
export const SPZ_VERSION = 2;
export const FLAG_ANTIALIASED = 0x1;
export const COLOR_SCALE = 0.15;

export interface PackedGaussiansHeader {
    magic: number;
    version: number;
    numPoints: number;
    shDegree: number;
    fractionalBits: number;
    flags: number;
    reserved: number;
}

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