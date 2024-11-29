import { SPZ_MAGIC, SPZ_VERSION, FLAG_ANTIALIASED } from './constant.js';
import { compressGzipped } from './compression.js';
import { packGaussians } from './spz-loader.js';
export async function serializePackedGaussians(packed) {
    const headerSize = 16;
    const totalSize = headerSize +
        packed.positions.length +
        packed.alphas.length +
        packed.colors.length +
        packed.scales.length +
        packed.rotations.length +
        packed.sh.length;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const uint8View = new Uint8Array(buffer);
    // Write header
    view.setUint32(0, SPZ_MAGIC, true);
    view.setUint32(4, SPZ_VERSION, true);
    view.setUint32(8, packed.numPoints, true);
    view.setUint8(12, packed.shDegree);
    view.setUint8(13, packed.fractionalBits);
    view.setUint8(14, packed.antialiased ? FLAG_ANTIALIASED : 0);
    view.setUint8(15, 0); // reserved
    // Write data
    let offset = headerSize;
    uint8View.set(packed.positions, offset);
    offset += packed.positions.length;
    uint8View.set(packed.alphas, offset);
    offset += packed.alphas.length;
    uint8View.set(packed.colors, offset);
    offset += packed.colors.length;
    uint8View.set(packed.scales, offset);
    offset += packed.scales.length;
    uint8View.set(packed.rotations, offset);
    offset += packed.rotations.length;
    uint8View.set(packed.sh, offset);
    return uint8View;
}
export async function serializeSpz(g) {
    const packed = packGaussians(g);
    const serialized = await serializePackedGaussians(packed);
    return compressGzipped(serialized);
}
