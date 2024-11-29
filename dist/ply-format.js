import { degreeForDim } from './constant.js';
function getFieldIndex(fields, name) {
    const index = fields.get(name);
    if (index === undefined) {
        console.error(`[PLY ERROR] Missing field: ${name}`);
        return -1;
    }
    return index;
}
export async function loadPly(stream) {
    const reader = stream.getReader();
    // Read header
    const textDecoder = new TextDecoder();
    let headerText = '';
    let headerDone = false;
    let binaryData = new Uint8Array();
    while (!headerDone) {
        const { value, done } = await reader.read();
        if (done)
            break;
        const text = textDecoder.decode(value, { stream: true });
        headerText += text;
        const endHeaderIndex = headerText.indexOf('\nend_header\n');
        if (endHeaderIndex !== -1) {
            headerDone = true;
            headerText = headerText.slice(0, endHeaderIndex);
            // Keep remaining binary data after header
            const fullText = textDecoder.decode(value);
            const binaryStart = fullText.indexOf('\nend_header\n') + '\nend_header\n'.length;
            binaryData = value.slice(binaryStart);
        }
    }
    const lines = headerText.split('\n');
    if (lines[0] !== 'ply') {
        throw new Error(`[PLY ERROR] not a .ply file`);
    }
    if (lines[1] !== 'format binary_little_endian 1.0') {
        throw new Error(`[PLY ERROR] unsupported .ply format`);
    }
    const vertexMatch = lines[2].match(/element vertex (\d+)/);
    if (!vertexMatch) {
        throw new Error(`[PLY ERROR] missing vertex count`);
    }
    const numPoints = parseInt(vertexMatch[1]);
    if (numPoints <= 0 || numPoints > 10 * 1024 * 1024) {
        throw new Error(`[PLY ERROR] invalid vertex count: ${numPoints}`);
    }
    // Parse fields
    const fields = new Map();
    let fieldIndex = 0;
    for (const line of lines.slice(3)) {
        if (line === 'end_header')
            break;
        if (!line.startsWith('property float ')) {
            throw new Error(`[PLY ERROR] unsupported property data type: ${line}`);
        }
        const name = line.substring('property float '.length);
        fields.set(name, fieldIndex++);
    }
    // Get field indices
    const positionIdx = ['x', 'y', 'z'].map(name => getFieldIndex(fields, name));
    const scaleIdx = ['scale_0', 'scale_1', 'scale_2'].map(name => getFieldIndex(fields, name));
    const rotIdx = ['rot_1', 'rot_2', 'rot_3', 'rot_0'].map(name => getFieldIndex(fields, name));
    const alphaIdx = [getFieldIndex(fields, 'opacity')];
    const colorIdx = ['f_dc_0', 'f_dc_1', 'f_dc_2'].map(name => getFieldIndex(fields, name));
    // Validate indices
    if ([...positionIdx, ...scaleIdx, ...rotIdx, ...alphaIdx, ...colorIdx].some(idx => idx < 0)) {
        throw new Error('[PLY ERROR] Missing required fields');
    }
    // Get SH indices
    const shIdx = [];
    for (let i = 0; i < 45; i++) {
        const idx = fields.get(`f_rest_${i}`);
        if (idx === undefined)
            break;
        shIdx.push(idx);
    }
    const shDim = Math.floor(shIdx.length / 3);
    // Read binary data
    const floatSize = 4;
    const stride = fields.size * floatSize;
    const totalSize = numPoints * stride;
    const buffer = new ArrayBuffer(totalSize);
    const uint8View = new Uint8Array(buffer);
    let offset = 0;
    // Copy initial binary data
    uint8View.set(binaryData, 0);
    offset += binaryData.length;
    // Read remaining data
    while (offset < totalSize) {
        const { value, done } = await reader.read();
        if (done)
            break;
        uint8View.set(value, offset);
        offset += value.length;
    }
    reader.releaseLock();
    // Create result
    const result = {
        numPoints,
        shDegree: degreeForDim(shDim),
        antialiased: false,
        positions: new Float32Array(numPoints * 3),
        scales: new Float32Array(numPoints * 3),
        rotations: new Float32Array(numPoints * 4),
        alphas: new Float32Array(numPoints),
        colors: new Float32Array(numPoints * 3),
        sh: new Float32Array(numPoints * shDim * 3)
    };
    // Parse values
    const dataView = new DataView(buffer);
    for (let i = 0; i < numPoints; i++) {
        const baseOffset = i * fields.size;
        // Copy positions, scales, rotations, alpha, colors, and SH coefficients
        for (let j = 0; j < 3; j++) {
            result.positions[i * 3 + j] = dataView.getFloat32((baseOffset + positionIdx[j]) * floatSize, true);
            result.scales[i * 3 + j] = dataView.getFloat32((baseOffset + scaleIdx[j]) * floatSize, true);
            result.colors[i * 3 + j] = dataView.getFloat32((baseOffset + colorIdx[j]) * floatSize, true);
        }
        for (let j = 0; j < 4; j++) {
            result.rotations[i * 4 + j] = dataView.getFloat32((baseOffset + rotIdx[j]) * floatSize, true);
        }
        result.alphas[i] = dataView.getFloat32((baseOffset + alphaIdx[0]) * floatSize, true);
        for (let j = 0; j < shDim; j++) {
            for (let c = 0; c < 3; c++) {
                result.sh[(i * shDim + j) * 3 + c] = dataView.getFloat32((baseOffset + shIdx[j + c * shDim]) * floatSize, true);
            }
        }
    }
    return result;
}
export function serializePly(data) {
    const N = data.numPoints;
    // Validate sizes
    if (data.positions.length !== N * 3 ||
        data.scales.length !== N * 3 ||
        data.rotations.length !== N * 4 ||
        data.alphas.length !== N ||
        data.colors.length !== N * 3) {
        throw new Error('[PLY ERROR] Invalid data sizes');
    }
    const shDim = Math.floor(data.sh.length / N / 3);
    const D = 17 + shDim * 3;
    // Create header
    const header = [
        'ply',
        'format binary_little_endian 1.0',
        `element vertex ${N}`,
        'property float x',
        'property float y',
        'property float z',
        'property float nx',
        'property float ny',
        'property float nz',
        'property float f_dc_0',
        'property float f_dc_1',
        'property float f_dc_2',
        ...Array.from({ length: shDim * 3 }, (_, i) => `property float f_rest_${i}`),
        'property float opacity',
        'property float scale_0',
        'property float scale_1',
        'property float scale_2',
        'property float rot_0',
        'property float rot_1',
        'property float rot_2',
        'property float rot_3',
        'end_header\n'
    ].join('\n');
    // Prepare values array
    const values = new Float32Array(N * D);
    let outIdx = 0, i3 = 0, i4 = 0;
    for (let i = 0; i < N; i++) {
        // Position (x, y, z)
        values[outIdx++] = data.positions[i3 + 0];
        values[outIdx++] = data.positions[i3 + 1];
        values[outIdx++] = data.positions[i3 + 2];
        // Normals (nx, ny, nz) - always zero
        values[outIdx++] = 0;
        values[outIdx++] = 0;
        values[outIdx++] = 0;
        // Colors (r, g, b)
        values[outIdx++] = data.colors[i3 + 0];
        values[outIdx++] = data.colors[i3 + 1];
        values[outIdx++] = data.colors[i3 + 2];
        // Spherical harmonics
        for (let j = 0; j < shDim; j++) {
            values[outIdx++] = data.sh[(i * shDim + j) * 3 + 0];
        }
        for (let j = 0; j < shDim; j++) {
            values[outIdx++] = data.sh[(i * shDim + j) * 3 + 1];
        }
        for (let j = 0; j < shDim; j++) {
            values[outIdx++] = data.sh[(i * shDim + j) * 3 + 2];
        }
        // Alpha
        values[outIdx++] = data.alphas[i];
        // Scale (sx, sy, sz)
        values[outIdx++] = data.scales[i3 + 0];
        values[outIdx++] = data.scales[i3 + 1];
        values[outIdx++] = data.scales[i3 + 2];
        // Rotation (qw, qx, qy, qz)
        values[outIdx++] = data.rotations[i4 + 3];
        values[outIdx++] = data.rotations[i4 + 0];
        values[outIdx++] = data.rotations[i4 + 1];
        values[outIdx++] = data.rotations[i4 + 2];
        i3 += 3;
        i4 += 4;
    }
    // Combine header and values into final buffer
    const headerBuffer = new TextEncoder().encode(header);
    const finalBuffer = new ArrayBuffer(headerBuffer.length + values.buffer.byteLength);
    const finalView = new Uint8Array(finalBuffer);
    finalView.set(headerBuffer, 0);
    finalView.set(new Uint8Array(values.buffer), headerBuffer.length);
    return finalBuffer;
}
