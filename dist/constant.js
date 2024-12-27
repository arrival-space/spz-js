export const SPZ_MAGIC = 0x5053474e; // NGSP = Niantic gaussian splat
export const SPZ_VERSION = 2;
export const FLAG_ANTIALIASED = 0x1;
export const COLOR_SCALE = 0.15;
export const SH_C0 = 0.28209479177387814;
export function degreeForDim(dim) {
    if (dim < 3)
        return 0;
    if (dim < 8)
        return 1;
    if (dim < 15)
        return 2;
    return 3;
}
export function dimForDegree(degree) {
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
