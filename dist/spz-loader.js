import { decompressGzipped } from './compression.js';
import { dimForDegree, FLAG_ANTIALIASED, SPZ_MAGIC } from './constant.js';
import { normalized, timesScalar, plus, halfToFloat } from './math.js';
const colorScale = 0.15;
function sigmoid(x) {
    return 1.0 / (1.0 + Math.exp(-x));
}
function invSigmoid(x) {
    return Math.log(x / (1.0 - x));
}
function toUint8(x) {
    return Math.min(Math.max(Math.round(x), 0), 255);
}
function quantizeSH(x, bucketSize) {
    let q = Math.round(x * 128.0 + 128.0);
    q = Math.floor((q + bucketSize / 2) / bucketSize) * bucketSize;
    return Math.min(Math.max(q, 0), 255);
}
function unquantizeSH(x) {
    return (x - 128.0) / 128.0;
}
function checkSizes(g) {
    const shDim = dimForDegree(g.shDegree);
    if (g.positions.length !== g.numPoints * 3)
        return false;
    if (g.scales.length !== g.numPoints * 3)
        return false;
    if (g.rotations.length !== g.numPoints * 4)
        return false;
    if (g.alphas.length !== g.numPoints)
        return false;
    if (g.colors.length !== g.numPoints * 3)
        return false;
    if (g.sh.length !== g.numPoints * shDim * 3)
        return false;
    return true;
}
export function packGaussians(g) {
    if (!checkSizes(g)) {
        throw new Error("Invalid GaussianCloud");
    }
    const numPoints = g.numPoints;
    const shDim = dimForDegree(g.shDegree);
    // Use 12 bits for the fractional part of coordinates (~0.25 millimeter resolution)
    const packed = {
        numPoints: g.numPoints,
        shDegree: g.shDegree,
        fractionalBits: 12,
        antialiased: g.antialiased,
        positions: new Uint8Array(numPoints * 3 * 3),
        scales: new Uint8Array(numPoints * 3),
        rotations: new Uint8Array(numPoints * 3),
        alphas: new Uint8Array(numPoints),
        colors: new Uint8Array(numPoints * 3),
        sh: new Uint8Array(numPoints * shDim * 3)
    };
    // Store coordinates as 24-bit fixed point values
    const scale = 1 << packed.fractionalBits;
    for (let i = 0; i < numPoints * 3; i++) {
        const fixed32 = Math.round(g.positions[i] * scale);
        packed.positions[i * 3 + 0] = fixed32 & 0xff;
        packed.positions[i * 3 + 1] = (fixed32 >> 8) & 0xff;
        packed.positions[i * 3 + 2] = (fixed32 >> 16) & 0xff;
    }
    for (let i = 0; i < numPoints * 3; i++) {
        packed.scales[i] = toUint8((g.scales[i] + 10.0) * 16.0);
    }
    for (let i = 0; i < numPoints; i++) {
        // Normalize the quaternion, make w positive, then store xyz
        // NOTE: These are already in xyzw order
        const q = normalized(Array.from(g.rotations.subarray(i * 4, i * 4 + 4)));
        const scaledQ = timesScalar(q, q[3] < 0 ? -127.5 : 127.5);
        const offsetQ = plus(scaledQ, [127.5, 127.5, 127.5, 127.5]);
        packed.rotations[i * 3 + 0] = toUint8(offsetQ[0]);
        packed.rotations[i * 3 + 1] = toUint8(offsetQ[1]);
        packed.rotations[i * 3 + 2] = toUint8(offsetQ[2]);
    }
    for (let i = 0; i < numPoints; i++) {
        // Apply sigmoid activation to alpha
        packed.alphas[i] = toUint8(sigmoid(g.alphas[i]) * 255.0);
    }
    for (let i = 0; i < numPoints * 3; i++) {
        // Convert SH DC component to wide RGB
        packed.colors[i] = toUint8(g.colors[i] * (colorScale * 255.0) + (0.5 * 255.0));
    }
    if (g.shDegree > 0) {
        // Spherical harmonics quantization parameters
        const sh1Bits = 5;
        const shRestBits = 4;
        const shPerPoint = dimForDegree(g.shDegree) * 3;
        for (let i = 0; i < numPoints * shPerPoint; i += shPerPoint) {
            let j = 0;
            for (; j < 9; j++) { // There are 9 coefficients for degree 1
                packed.sh[i + j] = quantizeSH(g.sh[i + j], 1 << (8 - sh1Bits));
            }
            for (; j < shPerPoint; j++) {
                packed.sh[i + j] = quantizeSH(g.sh[i + j], 1 << (8 - shRestBits));
            }
        }
    }
    return packed;
}
function unpackGaussians(packed) {
    const numPoints = packed.numPoints;
    const shDim = dimForDegree(packed.shDegree);
    const usesFloat16 = packed.positions.length === numPoints * 3 * 2;
    // Validate sizes
    if (!checkSizes2(packed, numPoints, shDim, usesFloat16)) {
        return null;
    }
    const result = {
        numPoints: packed.numPoints,
        shDegree: packed.shDegree,
        antialiased: packed.antialiased,
        positions: new Float32Array(numPoints * 3),
        scales: new Float32Array(numPoints * 3),
        rotations: new Float32Array(numPoints * 4),
        alphas: new Float32Array(numPoints),
        colors: new Float32Array(numPoints * 3),
        sh: new Float32Array(numPoints * shDim * 3)
    };
    // Decode positions
    if (usesFloat16) {
        // Decode legacy float16 format
        const halfData = new Uint16Array(packed.positions.buffer, packed.positions.byteOffset, numPoints * 3);
        for (let i = 0; i < numPoints * 3; i++) {
            result.positions[i] = halfToFloat(halfData[i]);
        }
    }
    else {
        // Decode 24-bit fixed point coordinates
        const scale = 1.0 / (1 << packed.fractionalBits);
        for (let i = 0; i < numPoints * 3; i++) {
            let fixed32 = packed.positions[i * 3 + 0];
            fixed32 |= packed.positions[i * 3 + 1] << 8;
            fixed32 |= packed.positions[i * 3 + 2] << 16;
            fixed32 |= (fixed32 & 0x800000) ? 0xff000000 : 0; // sign extension
            result.positions[i] = fixed32 * scale;
        }
    }
    // Decode scales
    for (let i = 0; i < numPoints * 3; i++) {
        result.scales[i] = packed.scales[i] / 16.0 - 10.0;
    }
    // Decode rotations
    for (let i = 0; i < numPoints; i++) {
        const r = packed.rotations.subarray(i * 3, i * 3 + 3);
        // Create xyz vector and apply scaling and offset
        const xyz = [
            r[0] / 127.5 - 1.0,
            r[1] / 127.5 - 1.0,
            r[2] / 127.5 - 1.0
        ];
        // Copy xyz components
        result.rotations[i * 4] = xyz[0];
        result.rotations[i * 4 + 1] = xyz[1];
        result.rotations[i * 4 + 2] = xyz[2];
        // Compute the real component (w) - quaternion is normalized and w is non-negative
        const squaredNorm = xyz[0] * xyz[0] + xyz[1] * xyz[1] + xyz[2] * xyz[2];
        result.rotations[i * 4 + 3] = Math.sqrt(Math.max(0.0, 1.0 - squaredNorm));
    }
    // Decode alphas
    for (let i = 0; i < numPoints; i++) {
        result.alphas[i] = invSigmoid(packed.alphas[i] / 255.0);
    }
    // Decode colors
    for (let i = 0; i < numPoints * 3; i++) {
        result.colors[i] = ((packed.colors[i] / 255.0) - 0.5) / colorScale;
    }
    // Decode spherical harmonics
    for (let i = 0; i < packed.sh.length; i++) {
        result.sh[i] = unquantizeSH(packed.sh[i]);
    }
    return result;
}
// Helper function to check sizes (matching C++ checkSizes function)
function checkSizes2(packed, numPoints, shDim, usesFloat16) {
    if (packed.positions.length !== numPoints * 3 * (usesFloat16 ? 2 : 3))
        return false;
    if (packed.scales.length !== numPoints * 3)
        return false;
    if (packed.rotations.length !== numPoints * 3)
        return false;
    if (packed.alphas.length !== numPoints)
        return false;
    if (packed.colors.length !== numPoints * 3)
        return false;
    if (packed.sh.length !== numPoints * shDim * 3)
        return false;
    return true;
}
const HEADER_SIZE = 16; // 4 + 4 + 4 + 1 + 1 + 1 + 1 bytes
const MAX_POINTS_TO_READ = 10000000;
function deserializePackedGaussians(buffer) {
    const view = new DataView(buffer);
    let offset = 0;
    // Read and validate header
    const header = {
        magic: view.getUint32(offset, true),
        version: view.getUint32(offset + 4, true),
        numPoints: view.getUint32(offset + 8, true),
        shDegree: view.getUint8(offset + 12),
        fractionalBits: view.getUint8(offset + 13),
        flags: view.getUint8(offset + 14),
        reserved: view.getUint8(offset + 15)
    };
    offset += HEADER_SIZE;
    // Validate header
    if (header.magic !== SPZ_MAGIC) {
        console.error("[SPZ ERROR] deserializePackedGaussians: header not found");
        return null;
    }
    if (header.version < 1 || header.version > 2) {
        console.error(`[SPZ ERROR] deserializePackedGaussians: version not supported: ${header.version}`);
        return null;
    }
    if (header.numPoints > MAX_POINTS_TO_READ) {
        console.error(`[SPZ ERROR] deserializePackedGaussians: Too many points: ${header.numPoints}`);
        return null;
    }
    if (header.shDegree > 3) {
        console.error(`[SPZ ERROR] deserializePackedGaussians: Unsupported SH degree: ${header.shDegree}`);
        return null;
    }
    const numPoints = header.numPoints;
    const shDim = dimForDegree(header.shDegree);
    const usesFloat16 = header.version === 1;
    // Initialize result object
    const result = {
        numPoints,
        shDegree: header.shDegree,
        fractionalBits: header.fractionalBits,
        antialiased: (header.flags & FLAG_ANTIALIASED) !== 0,
        positions: new Uint8Array(numPoints * 3 * (usesFloat16 ? 2 : 3)),
        scales: new Uint8Array(numPoints * 3),
        rotations: new Uint8Array(numPoints * 3),
        alphas: new Uint8Array(numPoints),
        colors: new Uint8Array(numPoints * 3),
        sh: new Uint8Array(numPoints * shDim * 3)
    };
    // Read data sections
    try {
        const uint8View = new Uint8Array(buffer);
        let positionsSize = result.positions.length;
        let currentOffset = offset;
        result.positions.set(uint8View.slice(currentOffset, currentOffset + positionsSize));
        currentOffset += positionsSize;
        result.alphas.set(uint8View.slice(currentOffset, currentOffset + result.alphas.length));
        currentOffset += result.alphas.length;
        result.colors.set(uint8View.slice(currentOffset, currentOffset + result.colors.length));
        currentOffset += result.colors.length;
        result.scales.set(uint8View.slice(currentOffset, currentOffset + result.scales.length));
        currentOffset += result.scales.length;
        result.rotations.set(uint8View.slice(currentOffset, currentOffset + result.rotations.length));
        currentOffset += result.rotations.length;
        result.sh.set(uint8View.slice(currentOffset, currentOffset + result.sh.length));
        // Verify we read the expected amount of data
        if (currentOffset + result.sh.length !== buffer.byteLength) {
            console.error("[SPZ ERROR] deserializePackedGaussians: incorrect buffer size");
            return null;
        }
    }
    catch (error) {
        console.error("[SPZ ERROR] deserializePackedGaussians: read error", error);
        return null;
    }
    return result;
}
async function loadSpzPacked(compressedData) {
    try {
        const decompressed = await decompressGzipped(compressedData);
        return deserializePackedGaussians(decompressed.buffer);
    }
    catch (error) {
        console.error("[SPZ ERROR] loadSpzPacked: decompression error", error);
        return null;
    }
}
export async function loadSpz(buffer) {
    const packed = await loadSpzPacked(buffer);
    return unpackGaussians(packed);
}
