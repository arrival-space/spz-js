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
