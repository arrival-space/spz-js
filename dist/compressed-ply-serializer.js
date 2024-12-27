// Parts of the code are taken from https://github.com/playcanvas/supersplat/blob/main/src/splat-serialize.ts
import { Quat } from 'playcanvas';
import { dimForDegree, SH_C0 } from './constant.js';
const generatedByString = 'spz-js package';
const shNames = new Array(45).fill('').map((_, i) => `f_rest_${i}`);
const shBandCoeffs = [0, 3, 8, 15];
/**
 * Serialize a GaussianCloud to a compressed PLY file as used by the PlayCanvas engine.
 *
 * @param data - The GaussianCloud to serialize.
 * @returns The serialized PLY file as an ArrayBuffer.
 */
export function serializeCompressedPly(data) {
    const numSplats = data.numPoints;
    const numChunks = Math.ceil(numSplats / 256);
    const indices = [];
    for (let i = 0; i < numSplats; ++i) {
        indices.push(i);
    }
    const chunkProps = [
        'min_x', 'min_y', 'min_z',
        'max_x', 'max_y', 'max_z',
        'min_scale_x', 'min_scale_y', 'min_scale_z',
        'max_scale_x', 'max_scale_y', 'max_scale_z',
        'min_r', 'min_g', 'min_b',
        'max_r', 'max_g', 'max_b'
    ];
    const vertexProps = [
        'packed_position',
        'packed_rotation',
        'packed_scale',
        'packed_color'
    ];
    const outputSHBands = data.shDegree;
    const outputSHCoeffs = shBandCoeffs[outputSHBands];
    const shHeader = outputSHBands ? [
        `element sh ${numSplats}`,
        new Array(outputSHCoeffs * 3).fill('').map((_, i) => `property uchar f_rest_${i}`)
    ].flat() : [];
    const headerText = [
        'ply',
        'format binary_little_endian 1.0',
        `comment ${generatedByString}`,
        `element chunk ${numChunks}`,
        chunkProps.map(p => `property float ${p}`),
        `element vertex ${numSplats}`,
        vertexProps.map(p => `property uint ${p}`),
        shHeader,
        'end_header\n'
    ].flat().join('\n');
    const header = (new TextEncoder()).encode(headerText);
    const result = new Uint8Array(header.byteLength +
        numChunks * chunkProps.length * 4 +
        numSplats * vertexProps.length * 4 +
        outputSHCoeffs * 3 * numSplats);
    const dataView = new DataView(result.buffer);
    result.set(header);
    const chunkOffset = header.byteLength;
    const vertexOffset = chunkOffset + numChunks * chunkProps.length * 4;
    const shOffset = vertexOffset + numSplats * 4 * 4;
    sortSplats(data, indices);
    const chunk = new Chunk();
    const singleSplat = new SingleSplat([
        'x', 'y', 'z',
        'scale_0', 'scale_1', 'scale_2',
        'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity',
        'rot_0', 'rot_1', 'rot_2', 'rot_3'
    ].concat(shNames.slice(0, outputSHCoeffs * 3)));
    for (let i = 0; i < numChunks; ++i) {
        const num = Math.min(numSplats, (i + 1) * 256) - i * 256;
        for (let j = 0; j < num; ++j) {
            const index = indices[i * 256 + j];
            // read splat
            singleSplat.read(data, index);
            // update chunk
            chunk.set(j, singleSplat);
            // quantize and write sh data
            let off = shOffset + (i * 256 + j) * outputSHCoeffs * 3;
            for (let k = 0; k < outputSHCoeffs * 3; ++k) {
                const nvalue = singleSplat.data[shNames[k]] / 8 + 0.5;
                dataView.setUint8(off++, Math.max(0, Math.min(255, Math.trunc(nvalue * 256))));
            }
        }
        const result = chunk.pack();
        const off = chunkOffset + i * 18 * 4;
        // write chunk data
        dataView.setFloat32(off + 0, result.px.min, true);
        dataView.setFloat32(off + 4, result.py.min, true);
        dataView.setFloat32(off + 8, result.pz.min, true);
        dataView.setFloat32(off + 12, result.px.max, true);
        dataView.setFloat32(off + 16, result.py.max, true);
        dataView.setFloat32(off + 20, result.pz.max, true);
        dataView.setFloat32(off + 24, result.sx.min, true);
        dataView.setFloat32(off + 28, result.sy.min, true);
        dataView.setFloat32(off + 32, result.sz.min, true);
        dataView.setFloat32(off + 36, result.sx.max, true);
        dataView.setFloat32(off + 40, result.sy.max, true);
        dataView.setFloat32(off + 44, result.sz.max, true);
        dataView.setFloat32(off + 48, result.cr.min, true);
        dataView.setFloat32(off + 52, result.cg.min, true);
        dataView.setFloat32(off + 56, result.cb.min, true);
        dataView.setFloat32(off + 60, result.cr.max, true);
        dataView.setFloat32(off + 64, result.cg.max, true);
        dataView.setFloat32(off + 68, result.cb.max, true);
        // write splat data
        const offset = vertexOffset + i * 256 * 4 * 4;
        const chunkSplats = Math.min(numSplats, (i + 1) * 256) - i * 256;
        for (let j = 0; j < chunkSplats; ++j) {
            dataView.setUint32(offset + j * 4 * 4 + 0, chunk.position[j], true);
            dataView.setUint32(offset + j * 4 * 4 + 4, chunk.rotation[j], true);
            dataView.setUint32(offset + j * 4 * 4 + 8, chunk.scale[j], true);
            dataView.setUint32(offset + j * 4 * 4 + 12, chunk.color[j], true);
        }
    }
    return result;
}
function sortSplats(data, indices) {
    // https://fgiesen.wordpress.com/2009/12/13/decoding-morton-codes/
    const encodeMorton3 = (x, y, z) => {
        const Part1By2 = (x) => {
            x &= 0x000003ff;
            x = (x ^ (x << 16)) & 0xff0000ff;
            x = (x ^ (x << 8)) & 0x0300f00f;
            x = (x ^ (x << 4)) & 0x030c30c3;
            x = (x ^ (x << 2)) & 0x09249249;
            return x;
        };
        return (Part1By2(z) << 2) + (Part1By2(y) << 1) + Part1By2(x);
    };
    let minx;
    let miny;
    let minz;
    let maxx;
    let maxy;
    let maxz;
    const centers = data.positions;
    for (let i = 0; i < data.numPoints; ++i) {
        const x = centers[i * 3 + 0];
        const y = centers[i * 3 + 1];
        const z = centers[i * 3 + 2];
        if (minx === undefined) {
            minx = maxx = x;
            miny = maxy = y;
            minz = maxz = z;
        }
        else {
            if (x < minx)
                minx = x;
            else if (x > maxx)
                maxx = x;
            if (y < miny)
                miny = y;
            else if (y > maxy)
                maxy = y;
            if (z < minz)
                minz = z;
            else if (z > maxz)
                maxz = z;
        }
    }
    const xlen = maxx - minx;
    const ylen = maxy - miny;
    const zlen = maxz - minz;
    const morton = new Uint32Array(data.numPoints);
    let idx = 0;
    for (let i = 0; i < data.numPoints; ++i) {
        const x = centers[i * 3 + 0];
        const y = centers[i * 3 + 1];
        const z = centers[i * 3 + 2];
        const ix = Math.floor(1024 * (x - minx) / xlen);
        const iy = Math.floor(1024 * (y - miny) / ylen);
        const iz = Math.floor(1024 * (z - minz) / zlen);
        morton[idx++] = encodeMorton3(ix, iy, iz);
    }
    // order splats by morton code
    indices.sort((a, b) => morton[a] - morton[b]);
}
class SingleSplat {
    data = {};
    constructor(members) {
        members.forEach((name) => {
            this.data[name] = 0;
        });
    }
    read(cloud, i) {
        // Direct mapping from GaussianCloud to SingleSplat format
        if (this.data.hasOwnProperty('x')) {
            this.data.x = cloud.positions[i * 3 + 0];
            this.data.y = cloud.positions[i * 3 + 1];
            this.data.z = cloud.positions[i * 3 + 2];
        }
        if (this.data.hasOwnProperty('scale_0')) {
            this.data.scale_0 = cloud.scales[i * 3 + 0];
            this.data.scale_1 = cloud.scales[i * 3 + 1];
            this.data.scale_2 = cloud.scales[i * 3 + 2];
        }
        if (this.data.hasOwnProperty('rot_0')) {
            this.data.rot_0 = cloud.rotations[i * 4 + 3];
            this.data.rot_1 = cloud.rotations[i * 4 + 0];
            this.data.rot_2 = cloud.rotations[i * 4 + 1];
            this.data.rot_3 = cloud.rotations[i * 4 + 2];
        }
        if (this.data.hasOwnProperty('f_dc_0')) {
            this.data.f_dc_0 = cloud.colors[i * 3 + 0];
            this.data.f_dc_1 = cloud.colors[i * 3 + 1];
            this.data.f_dc_2 = cloud.colors[i * 3 + 2];
        }
        if (this.data.hasOwnProperty('opacity')) {
            this.data.opacity = cloud.alphas[i];
        }
        // Handle SH coefficients if present
        const shDim = dimForDegree(cloud.shDegree);
        for (let j = 0; j < shDim; j++) {
            for (let c = 0; c < 3; c++) {
                const name = `f_rest_${j + c * shDim}`;
                if (this.data.hasOwnProperty(name)) {
                    this.data[name] = cloud.sh[(i * shDim + j) * 3 + c];
                }
            }
        }
    }
}
const q = new Quat();
// process and compress a chunk of 256 splats
class Chunk {
    static members = [
        'x', 'y', 'z',
        'scale_0', 'scale_1', 'scale_2',
        'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity',
        'rot_0', 'rot_1', 'rot_2', 'rot_3'
    ];
    size;
    /// @ts-ignore
    data = {};
    // compressed data
    position;
    rotation;
    scale;
    color;
    constructor(size = 256) {
        this.size = size;
        Chunk.members.forEach((m) => {
            this.data[m] = new Float32Array(size);
        });
        this.position = new Uint32Array(size);
        this.rotation = new Uint32Array(size);
        this.scale = new Uint32Array(size);
        this.color = new Uint32Array(size);
    }
    set(index, splat) {
        Chunk.members.forEach((name) => {
            this.data[name][index] = splat.data[name];
        });
    }
    pack() {
        const calcMinMax = (data) => {
            let min;
            let max;
            min = max = data[0];
            for (let i = 1; i < data.length; ++i) {
                const v = data[i];
                min = Math.min(min, v);
                max = Math.max(max, v);
            }
            return { min, max };
        };
        const normalize = (x, min, max) => {
            if (x <= min)
                return 0;
            if (x >= max)
                return 1;
            return (max - min < 0.00001) ? 0 : (x - min) / (max - min);
        };
        const data = this.data;
        const x = data.x;
        const y = data.y;
        const z = data.z;
        const scale_0 = data.scale_0;
        const scale_1 = data.scale_1;
        const scale_2 = data.scale_2;
        const rot_0 = data.rot_0;
        const rot_1 = data.rot_1;
        const rot_2 = data.rot_2;
        const rot_3 = data.rot_3;
        const f_dc_0 = data.f_dc_0;
        const f_dc_1 = data.f_dc_1;
        const f_dc_2 = data.f_dc_2;
        const opacity = data.opacity;
        const px = calcMinMax(x);
        const py = calcMinMax(y);
        const pz = calcMinMax(z);
        const sx = calcMinMax(scale_0);
        const sy = calcMinMax(scale_1);
        const sz = calcMinMax(scale_2);
        // clamp scale because sometimes values are at infinity
        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
        sx.min = clamp(sx.min, -20, 20);
        sx.max = clamp(sx.max, -20, 20);
        sy.min = clamp(sy.min, -20, 20);
        sy.max = clamp(sy.max, -20, 20);
        sz.min = clamp(sz.min, -20, 20);
        sz.max = clamp(sz.max, -20, 20);
        // convert f_dc_ to colors before calculating min/max and packaging
        for (let i = 0; i < f_dc_0.length; ++i) {
            f_dc_0[i] = f_dc_0[i] * SH_C0 + 0.5;
            f_dc_1[i] = f_dc_1[i] * SH_C0 + 0.5;
            f_dc_2[i] = f_dc_2[i] * SH_C0 + 0.5;
        }
        const cr = calcMinMax(f_dc_0);
        const cg = calcMinMax(f_dc_1);
        const cb = calcMinMax(f_dc_2);
        const packUnorm = (value, bits) => {
            const t = (1 << bits) - 1;
            return Math.max(0, Math.min(t, Math.floor(value * t + 0.5)));
        };
        const pack111011 = (x, y, z) => {
            return packUnorm(x, 11) << 21 |
                packUnorm(y, 10) << 11 |
                packUnorm(z, 11);
        };
        const pack8888 = (x, y, z, w) => {
            return packUnorm(x, 8) << 24 |
                packUnorm(y, 8) << 16 |
                packUnorm(z, 8) << 8 |
                packUnorm(w, 8);
        };
        // pack quaternion into 2,10,10,10
        const packRot = (x, y, z, w) => {
            q.set(x, y, z, w).normalize();
            const a = [q.x, q.y, q.z, q.w];
            const largest = a.reduce((curr, v, i) => (Math.abs(v) > Math.abs(a[curr]) ? i : curr), 0);
            if (a[largest] < 0) {
                a[0] = -a[0];
                a[1] = -a[1];
                a[2] = -a[2];
                a[3] = -a[3];
            }
            const norm = Math.sqrt(2) * 0.5;
            let result = largest;
            for (let i = 0; i < 4; ++i) {
                if (i !== largest) {
                    result = (result << 10) | packUnorm(a[i] * norm + 0.5, 10);
                }
            }
            return result;
        };
        // pack
        for (let i = 0; i < this.size; ++i) {
            this.position[i] = pack111011(normalize(x[i], px.min, px.max), normalize(y[i], py.min, py.max), normalize(z[i], pz.min, pz.max));
            this.rotation[i] = packRot(rot_0[i], rot_1[i], rot_2[i], rot_3[i]);
            this.scale[i] = pack111011(normalize(scale_0[i], sx.min, sx.max), normalize(scale_1[i], sy.min, sy.max), normalize(scale_2[i], sz.min, sz.max));
            this.color[i] = pack8888(normalize(f_dc_0[i], cr.min, cr.max), normalize(f_dc_1[i], cg.min, cg.max), normalize(f_dc_2[i], cb.min, cb.max), 1 / (1 + Math.exp(-opacity[i])));
        }
        return { px, py, pz, sx, sy, sz, cr, cg, cb };
    }
}
