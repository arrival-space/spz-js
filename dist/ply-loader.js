import { degreeForDim } from './constant.js';
/* ────────────────────────────── constants ─────────────────────────────── */
const END_MARKER = /\r?\nend_header\r?\n/; // handles \n  and  \r\n
/* ────────────────────────────── helpers ───────────────────────────────── */
function getFieldIndex(map, name) {
    const idx = map.get(name);
    if (idx === undefined) {
        throw new Error(`[PLY] Missing required field "${name}"`);
    }
    return idx;
}
function byteSizeForType(type) {
    switch (type) {
        case 'float':
        case 'int':
        case 'uint':
        case 'uint32':
        case 'int32': return 4;
        case 'double': return 8;
        case 'uchar':
        case 'char':
        case 'uint8':
        case 'int8': return 1;
        case 'ushort':
        case 'short':
        case 'uint16':
        case 'int16': return 2;
        default:
            throw new Error(`[PLY] Unsupported property type "${type}"`);
    }
}
/* ────────────────────────────── parser ────────────────────────────────── */
export async function loadPly(readable) {
    /* ---------- 1. Stream-safe header read -------------------------------- */
    const reader = readable.getReader();
    const decoder = new TextDecoder();
    const headerChunks = [];
    let headerText = '';
    let binaryStartByteOffset = 0; // where vertex blob begins (byte index)
    while (true) {
        const { value, done } = await reader.read();
        if (done)
            throw new Error('[PLY] Unexpected EOF before end_header');
        headerChunks.push(value);
        headerText += decoder.decode(value, { stream: true });
        const m = headerText.match(END_MARKER);
        if (!m)
            continue; // need more data
        const headerChars = headerText.indexOf(m[0]) + m[0].length;
        binaryStartByteOffset = new TextEncoder().encode(headerText.slice(0, headerChars)).length;
        // Trim sentinel from headerText (makes later `.split` cleaner)
        headerText = headerText.slice(0, headerChars - m[0].length);
        break;
    }
    /* ---------- 2. Stitch chunks & grab first payload bytes --------------- */
    const headerTotal = headerChunks.reduce((s, c) => s + c.length, 0);
    const stitched = new Uint8Array(headerTotal);
    let off = 0;
    for (const c of headerChunks) {
        stitched.set(c, off);
        off += c.length;
    }
    const initialBinary = stitched.subarray(binaryStartByteOffset);
    /* ---------- 3. Robust header parsing ---------------------------------- */
    const lines = headerText.split(/\r?\n/).filter(Boolean);
    if (lines[0] !== 'ply') {
        throw new Error('[PLY] Not a PLY file');
    }
    let formatOK = false;
    let numPoints = 0;
    const propDefs = [];
    let strideBytes = 0;
    let parsingVertexProps = false;
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('format binary_little_endian')) {
            formatOK = true;
            continue;
        }
        if (line.startsWith('comment') || line.startsWith('obj_info'))
            continue;
        if (line.startsWith('element')) {
            const [, elem, count] = line.split(/\s+/);
            parsingVertexProps = (elem === 'vertex');
            if (elem === 'vertex')
                numPoints = Number(count);
            continue;
        }
        if (line.startsWith('property') && parsingVertexProps) {
            const [, type, name] = line.split(/\s+/);
            const size = byteSizeForType(type);
            propDefs.push({ name, type, offsetBytes: strideBytes });
            strideBytes += size;
            continue;
        }
    }
    if (!formatOK)
        throw new Error('[PLY] Only binary_little_endian supported');
    if (!numPoints)
        throw new Error('[PLY] Vertex count missing or zero');
    /* ---------- 4. Fast lookup tables ------------------------------------- */
    const fieldOffsetMap = new Map();
    propDefs.forEach(({ name, offsetBytes }) => fieldOffsetMap.set(name, offsetBytes / 4) // convert to float index
    );
    const posIdx = ['x', 'y', 'z'].map(n => getFieldIndex(fieldOffsetMap, n));
    const scaleIdx = ['scale_0', 'scale_1', 'scale_2'].map(n => getFieldIndex(fieldOffsetMap, n));
    const rotIdx = ['rot_1', 'rot_2', 'rot_3', 'rot_0'].map(n => getFieldIndex(fieldOffsetMap, n));
    const alphaIdx = [getFieldIndex(fieldOffsetMap, 'opacity')];
    const colorIdx = ['f_dc_0', 'f_dc_1', 'f_dc_2'].map(n => getFieldIndex(fieldOffsetMap, n));
    const shIdx = [];
    for (let i = 0;; i++) {
        const idx = fieldOffsetMap.get(`f_rest_${i}`);
        if (idx === undefined)
            break;
        shIdx.push(idx);
    }
    const shDim = Math.floor(shIdx.length / 3);
    const strideFloats = strideBytes / 4;
    /* ---------- 5. Stream binary payload directly into pre-alloc buffer --- */
    const totalBinaryBytes = numPoints * strideBytes;
    const buffer = new ArrayBuffer(totalBinaryBytes);
    const dest = new Uint8Array(buffer);
    // paste the bytes we already have
    dest.set(initialBinary, 0);
    let cursor = initialBinary.length;
    while (cursor < totalBinaryBytes) {
        const { value, done } = await reader.read();
        if (done)
            throw new Error('[PLY] Truncated binary section');
        dest.set(value, cursor);
        cursor += value.length;
    }
    reader.releaseLock();
    /* ---------- 6. Decode vertices via Float32 view ----------------------- */
    const f32 = new Float32Array(buffer);
    const result = {
        numPoints,
        shDegree: degreeForDim(shDim),
        antialiased: false,
        positions: new Float32Array(numPoints * 3),
        scales: new Float32Array(numPoints * 3),
        rotations: new Float32Array(numPoints * 4),
        alphas: new Float32Array(numPoints),
        colors: new Float32Array(numPoints * 3),
        sh: new Float32Array(numPoints * shDim * 3),
    };
    for (let i = 0; i < numPoints; i++) {
        const base = i * strideFloats;
        /* positions, scales, colours */
        result.positions.set([
            f32[base + posIdx[0]],
            f32[base + posIdx[1]],
            f32[base + posIdx[2]],
        ], i * 3);
        result.scales.set([
            f32[base + scaleIdx[0]],
            f32[base + scaleIdx[1]],
            f32[base + scaleIdx[2]],
        ], i * 3);
        result.colors.set([
            f32[base + colorIdx[0]],
            f32[base + colorIdx[1]],
            f32[base + colorIdx[2]],
        ], i * 3);
        /* rotations (quat wxyz order rot_0..3) */
        result.rotations.set([
            f32[base + rotIdx[0]],
            f32[base + rotIdx[1]],
            f32[base + rotIdx[2]],
            f32[base + rotIdx[3]],
        ], i * 4);
        /* alpha */
        result.alphas[i] = f32[base + alphaIdx[0]];
        /* spherical harmonics */
        for (let j = 0; j < shDim; j++) {
            const dst = (i * shDim + j) * 3;
            result.sh[dst] = f32[base + shIdx[j]]; // R
            result.sh[dst + 1] = f32[base + shIdx[j + shDim]]; // G
            result.sh[dst + 2] = f32[base + shIdx[j + 2 * shDim]]; // B
        }
    }
    return result;
}
// --------------------------------------------------------------------------
