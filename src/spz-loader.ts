import { GaussianCloud, PackedGaussians, Quat4f } from './types.js';
import { decompressGzipped } from './compression.js';
import { dimForDegree, FLAG_ANTIALIASED, SPZ_MAGIC } from './constant.js';
import { deserializePackedGaussiansV4, readSpzV4Header } from './spz-v4-loader.js';
import {
    normalized,
    timesScalar,
    plus,
    halfToFloat
} from './math.js';

const colorScale = 0.15;
const SQRT1_2 = 1 / Math.sqrt(2);
const QUAT_SMALLEST_THREE_MASK = (1 << 9) - 1; // 9-bit magnitude mask (511)

function sigmoid(x: number): number {
    return 1.0 / (1.0 + Math.exp(-x));
}

function invSigmoid(x: number): number {
    return Math.log(x / (1.0 - x));
}

function toUint8(x: number): number {
    return Math.min(Math.max(Math.round(x), 0), 255);
}

function quantizeSH(x: number, bucketSize: number): number {
    let q = Math.round(x * 128.0 + 128.0);
    q = Math.floor((q + bucketSize / 2) / bucketSize) * bucketSize;
    return Math.min(Math.max(q, 0), 255);
}

function unquantizeSH(x: number): number {
    return (x - 128.0) / 128.0;
}

function checkSizes(g: GaussianCloud): boolean {
    const shDim = dimForDegree(g.shDegree);
    if (g.positions.length !== g.numPoints * 3) return false;
    if (g.scales.length !== g.numPoints * 3) return false;
    if (g.rotations.length !== g.numPoints * 4) return false;
    if (g.alphas.length !== g.numPoints) return false;
    if (g.colors.length !== g.numPoints * 3) return false;
    if (g.sh.length !== g.numPoints * shDim * 3) return false;
    return true;
}

export function packGaussians(g: GaussianCloud): PackedGaussians {
    if (!checkSizes(g)) {
        throw new Error("Invalid GaussianCloud");
    }

    const numPoints = g.numPoints;
    const shDim = dimForDegree(g.shDegree);

    // Use 12 bits for the fractional part of coordinates (~0.25 millimeter resolution)
    const packed: PackedGaussians = {
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
        const q = normalized(Array.from(g.rotations.subarray(i * 4, i * 4 + 4)) as Quat4f);
        const scaledQ = timesScalar(q, q[3] < 0 ? -127.5 : 127.5);
        const offsetQ = plus(scaledQ, [127.5, 127.5, 127.5, 127.5] as Quat4f);

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
            for (; j < 9; j++) {  // There are 9 coefficients for degree 1
                packed.sh[i + j] = quantizeSH(g.sh[i + j], 1 << (8 - sh1Bits));
            }
            for (; j < shPerPoint; j++) {
                packed.sh[i + j] = quantizeSH(g.sh[i + j], 1 << (8 - shRestBits));
            }
        }
    }

    return packed;
}

function unpackGaussians(packed: PackedGaussians): GaussianCloud {
    const numPoints = packed.numPoints;
    const shDim = dimForDegree(packed.shDegree);
    const usesFloat16 = packed.positions.length === numPoints * 3 * 2;
    const rotationBytes =
        packed.rotations.length === numPoints * 4 ? 4 :
        packed.rotations.length === numPoints * 3 ? 3 :
        0;

    // Validate sizes
    if (!checkSizes2(packed, numPoints, shDim, usesFloat16, rotationBytes)) {
        return null;
    }

    const result: GaussianCloud = {
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
    } else {
        // Decode 24-bit fixed point coordinates
        const scale = 1.0 / (1 << packed.fractionalBits);
        for (let i = 0; i < numPoints * 3; i++) {
            let fixed32 = packed.positions[i * 3 + 0];
            fixed32 |= packed.positions[i * 3 + 1] << 8;
            fixed32 |= packed.positions[i * 3 + 2] << 16;
            fixed32 |= (fixed32 & 0x800000) ? 0xff000000 : 0;  // sign extension
            result.positions[i] = fixed32 * scale;
        }
    }

    // Decode scales
    for (let i = 0; i < numPoints * 3; i++) {
        result.scales[i] = packed.scales[i] / 16.0 - 10.0;
    }

    // Decode rotations
    if (rotationBytes === 3) {
        // V2 (and earlier): store xyz, reconstruct w (non-negative)
        for (let i = 0; i < numPoints; i++) {
            const r = packed.rotations.subarray(i * 3, i * 3 + 3);
            // Create xyz vector and apply scaling and offset
            const x = r[0] / 127.5 - 1.0;
            const y = r[1] / 127.5 - 1.0;
            const z = r[2] / 127.5 - 1.0;

            // Copy xyz components (xyzw order)
            const o = i * 4;
            result.rotations[o + 0] = x;
            result.rotations[o + 1] = y;
            result.rotations[o + 2] = z;

            // Compute the real component (w) - quaternion is normalized and w is non-negative
            const squaredNorm = x * x + y * y + z * z;
            result.rotations[o + 3] = Math.sqrt(Math.max(0.0, 1.0 - squaredNorm));
        }
    } else {
        // V3+: "smallest three" quaternion packing (4 bytes)
        for (let i = 0; i < numPoints; i++) {
            const inOff = i * 4;
            // little-endian 32-bit packed value
            let comp =
                (packed.rotations[inOff + 0]) |
                (packed.rotations[inOff + 1] << 8) |
                (packed.rotations[inOff + 2] << 16) |
                (packed.rotations[inOff + 3] << 24);

            const iLargest = comp >>> 30; // 0..3 component index (xyzw order)
            let sumSquares = 0.0;
            const outOff = i * 4;

            // Unpack in reverse order (matches C++ reference)
            for (let k = 3; k >= 0; --k) {
                if (k === iLargest) continue;
                const mag = comp & QUAT_SMALLEST_THREE_MASK;
                const negbit = (comp >>> 9) & 0x1;
                comp = comp >>> 10;

                let v = SQRT1_2 * (mag / QUAT_SMALLEST_THREE_MASK);
                if (negbit === 1) v = -v;
                result.rotations[outOff + k] = v;
                sumSquares += v * v;
            }

            // Largest component is positive (same rotation for q and -q)
            result.rotations[outOff + iLargest] = Math.sqrt(Math.max(0.0, 1.0 - sumSquares));
        }
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
function checkSizes2(
    packed: PackedGaussians,
    numPoints: number,
    shDim: number,
    usesFloat16: boolean,
    rotationBytes: number
): boolean {
    if (packed.positions.length !== numPoints * 3 * (usesFloat16 ? 2 : 3)) return false;
    if (packed.scales.length !== numPoints * 3) return false;
    if (rotationBytes !== 3 && rotationBytes !== 4) return false;
    if (packed.rotations.length !== numPoints * rotationBytes) return false;
    if (packed.alphas.length !== numPoints) return false;
    if (packed.colors.length !== numPoints * 3) return false;
    if (packed.sh.length !== numPoints * shDim * 3) return false;
    return true;
}

interface PackedGaussiansHeader {
    magic: number;
    version: number;
    numPoints: number;
    shDegree: number;
    fractionalBits: number;
    flags: number;
    reserved: number;
}

const HEADER_SIZE = 16; // 4 + 4 + 4 + 1 + 1 + 1 + 1 bytes
const MAX_POINTS_TO_READ = 10000000;

function deserializePackedGaussians(buffer: ArrayBufferLike): PackedGaussians | null {
    const view = new DataView(buffer);
    let offset = 0;

    // Read and validate header
    const header: PackedGaussiansHeader = {
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
    if (header.version < 1 || header.version > 3) {
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
    const usesQuaternionSmallestThree = header.version >= 3;

    // Initialize result object
    const result: PackedGaussians = {
        numPoints,
        shDegree: header.shDegree,
        fractionalBits: header.fractionalBits,
        antialiased: (header.flags & FLAG_ANTIALIASED) !== 0,
        positions: new Uint8Array(numPoints * 3 * (usesFloat16 ? 2 : 3)),
        scales: new Uint8Array(numPoints * 3),
        rotations: new Uint8Array(numPoints * (usesQuaternionSmallestThree ? 4 : 3)),
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
    } catch (error) {
        console.error("[SPZ ERROR] deserializePackedGaussians: read error", error);
        return null;
    }

    return result;
}

async function loadSpzPacked(compressedData: Uint8Array): Promise<PackedGaussians | null> {
    try {
        // v4 dropped the outer gzip: its header is plaintext, so the magic is
        // readable straight away and each attribute is its own ZSTD stream.
        // v1-3 are one gzip stream, and start with the gzip magic instead.
        const buffer = toArrayBuffer(compressedData);
        if (readSpzV4Header(buffer)) {
            return deserializePackedGaussiansV4(buffer);
        }

        const decompressed = await decompressGzipped(compressedData);
        return deserializePackedGaussians(toArrayBuffer(decompressed));
    } catch (error) {
        console.error("[SPZ ERROR] loadSpzPacked: decompression error", error);
        return null;
    }
}

/**
 * The bytes of a view as a standalone ArrayBuffer. A Uint8Array can be a window
 * into a larger buffer (a Node Buffer usually is), and both header readers index
 * from offset 0, so anything that is not already the whole buffer is copied.
 */
function toArrayBuffer(data: Uint8Array): ArrayBufferLike {
    return (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) ?
        data.buffer :
        data.slice().buffer;
}

export async function loadSpz(buffer: Uint8Array): Promise<GaussianCloud> {
    const packed = await loadSpzPacked(buffer);
    if (!packed) {
        // The reader already logged what it objected to. Throwing beats returning a
        // null the caller then dereferences - which is what used to happen.
        throw new Error("Failed to read SPZ file: unsupported version or corrupt data");
    }

    const cloud = unpackGaussians(packed);
    if (!cloud) {
        throw new Error("Failed to read SPZ file: attribute sizes do not match the header");
    }

    return cloud;
}