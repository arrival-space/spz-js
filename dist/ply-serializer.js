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
