import { PackedGaussians } from './types.js';
import { decompressZstd } from './compression.js';
import {
    dimForDegree,
    FLAG_ANTIALIASED,
    FLAG_HAS_EXTENSIONS,
    SPZ_MAGIC,
    SPZ_VERSION_ZSTD
} from './constant.js';

/**
 * SPZ v4 container reader.
 *
 * v1-3 are a single gzip stream whose plaintext is a 16-byte header followed by
 * the attribute blocks laid end to end. v4 changed the container completely:
 *
 *   [32-byte plaintext header][extensions?][table of contents][ZSTD stream]...
 *
 * The header is no longer compressed (so the magic is readable without
 * inflating anything), each attribute is its own ZSTD frame, and a table of
 * contents gives each frame's compressed and uncompressed size. That is what
 * lets a reader pull just the positions out of a large file - this
 * implementation decompresses every stream, since the rest of the library wants
 * a whole {@link PackedGaussians}.
 *
 * The attribute encodings themselves are unchanged from v3: 24-bit fixed point
 * positions, log-encoded scales, sigmoid alphas, and smallest-three (4-byte)
 * rotations, so unpackGaussians handles the result as-is.
 */

/** 32 bytes: the 16 of v1-3, plus numStreams and the table of contents offset. */
const HEADER_SIZE_V4 = 32;
/** compressedSize (u64) + uncompressedSize (u64) per stream. */
const TOC_ENTRY_SIZE = 16;
const MAX_POINTS_TO_READ = 10000000;

/** Stream order in the table of contents. Zero-length streams are not stored. */
const STREAM_NAMES = ['positions', 'alphas', 'colors', 'scales', 'rotations', 'sh'] as const;

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
export function readSpzV4Header(buffer: ArrayBufferLike): SpzV4Header | null {
    if (buffer.byteLength < HEADER_SIZE_V4) return null;

    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== SPZ_MAGIC) return null;

    const version = view.getUint32(4, true);
    if (version < SPZ_VERSION_ZSTD) return null;

    return {
        magic: SPZ_MAGIC,
        version,
        numPoints: view.getUint32(8, true),
        shDegree: view.getUint8(12),
        fractionalBits: view.getUint8(13),
        flags: view.getUint8(14),
        numStreams: view.getUint8(15),
        tocByteOffset: view.getUint32(16, true)
    };
}

/**
 * Parse a v4 container into the same {@link PackedGaussians} shape the gzip-based
 * versions produce.
 *
 * SH degree 4 (24 coefficients per channel) exists in v4 but has no
 * representation in this library's GaussianCloud, which tops out at degree 3.
 * Such a file is read at degree 3: the first 15 coefficients of each channel are
 * kept and the rest dropped, rather than failing the load outright.
 */
export function deserializePackedGaussiansV4(buffer: ArrayBufferLike): PackedGaussians | null {
    const header = readSpzV4Header(buffer);
    if (!header) {
        console.error('[SPZ ERROR] deserializePackedGaussiansV4: not a v4 container');
        return null;
    }
    if (header.version !== 4) {
        console.error(`[SPZ ERROR] deserializePackedGaussiansV4: version not supported: ${header.version}`);
        return null;
    }
    if (header.numPoints > MAX_POINTS_TO_READ) {
        console.error(`[SPZ ERROR] deserializePackedGaussiansV4: Too many points: ${header.numPoints}`);
        return null;
    }
    if (header.shDegree > 4) {
        console.error(`[SPZ ERROR] deserializePackedGaussiansV4: Unsupported SH degree: ${header.shDegree}`);
        return null;
    }

    if ((header.flags & FLAG_HAS_EXTENSIONS) !== 0) {
        // Extension records live between the header and the table of contents, and
        // the TOC offset already skips past them - so they cost us nothing to ignore.
        console.warn('[SPZ WARNING] deserializePackedGaussiansV4: file has extensions, which are ignored');
    }

    const numPoints = header.numPoints;

    // Coefficients per channel as STORED (degree 4 stores 24), and as KEPT (max 15).
    const storedShDim = header.shDegree === 4 ? 24 : dimForDegree(header.shDegree);
    const outShDegree = Math.min(header.shDegree, 3);
    const outShDim = dimForDegree(outShDegree);

    const sizes: number[] = [
        numPoints * 9,              // positions: 3 x 24-bit fixed point
        numPoints,                  // alphas:    u8
        numPoints * 3,              // colors:    u8 x 3
        numPoints * 3,              // scales:    u8 x 3
        numPoints * 4,              // rotations: smallest-three, u32
        numPoints * storedShDim * 3 // sh:        u8 per coefficient
    ];

    // A stream is omitted entirely when it would be empty (SH at degree 0).
    const present = sizes.map(size => size > 0);
    const expectedStreams = present.filter(Boolean).length;
    if (header.numStreams !== expectedStreams) {
        console.error(
            `[SPZ ERROR] deserializePackedGaussiansV4: expected ${expectedStreams} streams, found ${header.numStreams}`
        );
        return null;
    }

    const tocSize = header.numStreams * TOC_ENTRY_SIZE;
    if (header.tocByteOffset < HEADER_SIZE_V4 || header.tocByteOffset + tocSize > buffer.byteLength) {
        console.error('[SPZ ERROR] deserializePackedGaussiansV4: table of contents out of bounds');
        return null;
    }

    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const streams: Record<string, Uint8Array> = {};

    let dataOffset = header.tocByteOffset + tocSize;
    let streamIndex = 0;

    try {
        for (let i = 0; i < sizes.length; i++) {
            if (!present[i]) {
                streams[STREAM_NAMES[i]] = new Uint8Array(0);
                continue;
            }

            const tocOffset = header.tocByteOffset + streamIndex * TOC_ENTRY_SIZE;
            const compressedSize = Number(view.getBigUint64(tocOffset, true));
            const uncompressedSize = Number(view.getBigUint64(tocOffset + 8, true));

            if (uncompressedSize !== sizes[i]) {
                console.error(
                    `[SPZ ERROR] deserializePackedGaussiansV4: unexpected size of the ${STREAM_NAMES[i]} stream: ` +
                    `${uncompressedSize}, expected ${sizes[i]}`
                );
                return null;
            }
            if (dataOffset + compressedSize > buffer.byteLength) {
                console.error(
                    `[SPZ ERROR] deserializePackedGaussiansV4: the ${STREAM_NAMES[i]} stream runs past the end of the file`
                );
                return null;
            }

            streams[STREAM_NAMES[i]] = decompressZstd(
                bytes.subarray(dataOffset, dataOffset + compressedSize),
                uncompressedSize
            );

            dataOffset += compressedSize;
            streamIndex++;
        }
    } catch (error) {
        console.error('[SPZ ERROR] deserializePackedGaussiansV4: read error', error);
        return null;
    }

    let sh = streams.sh;
    if (header.shDegree === 4) {
        // Keep degree 3 (15 coefficients per channel) out of the 24 stored, so the
        // file loads instead of being rejected for a band we cannot represent.
        console.warn('[SPZ WARNING] deserializePackedGaussiansV4: SH degree 4 truncated to 3');
        const srcStride = storedShDim * 3;
        const dstStride = outShDim * 3;
        const truncated = new Uint8Array(numPoints * dstStride);
        for (let i = 0; i < numPoints; i++) {
            truncated.set(sh.subarray(i * srcStride, i * srcStride + dstStride), i * dstStride);
        }
        sh = truncated;
    }

    return {
        numPoints,
        shDegree: outShDegree,
        fractionalBits: header.fractionalBits,
        antialiased: (header.flags & FLAG_ANTIALIASED) !== 0,
        positions: streams.positions,
        scales: streams.scales,
        rotations: streams.rotations,
        alphas: streams.alphas,
        colors: streams.colors,
        sh
    };
}
