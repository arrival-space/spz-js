// This file is largely based on the ply.js and gsplat-compressed-data.js files from "playcanvas".
import { Quat, Vec4, Vec3 } from "playcanvas";
import { dimForDegree, SH_C0 } from "./constant.js";
const magicBytes = new Uint8Array([112, 108, 121, 10]); // ply\n
const endHeaderBytes = new Uint8Array([10, 101, 110, 100, 95, 104, 101, 97, 100, 101, 114, 10]); // \nend_header\n
const dataTypeMap = new Map([
    ['char', Int8Array],
    ['uchar', Uint8Array],
    ['short', Int16Array],
    ['ushort', Uint16Array],
    ['int', Int32Array],
    ['uint', Uint32Array],
    ['float', Float32Array],
    ['double', Float64Array]
]);
// parse the ply header text and return an array of Element structures and a
// string containing the ply format
const parseHeader = (lines) => {
    const elements = [];
    let format = null;
    for (let i = 1; i < lines.length; ++i) {
        const words = lines[i].split(' ');
        switch (words[0]) {
            case 'format':
                format = words[1];
                break;
            case 'element':
                elements.push({
                    name: words[1],
                    count: parseInt(words[2], 10),
                    properties: []
                });
                break;
            case 'property': {
                if (!dataTypeMap.has(words[1])) {
                    throw new Error(`Unrecognized property data type '${words[1]}' in ply header`);
                }
                const element = elements[elements.length - 1];
                element.properties.push({
                    type: words[1],
                    name: words[2],
                    storage: null,
                    byteSize: dataTypeMap.get(words[1]).BYTES_PER_ELEMENT
                });
                break;
            }
            default:
                throw new Error(`Unrecognized header value '${words[0]}' in ply header`);
        }
    }
    return { elements, format };
};
const isCompressedPly = (elements) => {
    const chunkProperties = [
        'min_x', 'min_y', 'min_z',
        'max_x', 'max_y', 'max_z',
        'min_scale_x', 'min_scale_y', 'min_scale_z',
        'max_scale_x', 'max_scale_y', 'max_scale_z',
        'min_r', 'min_g', 'min_b',
        'max_r', 'max_g', 'max_b'
    ];
    const vertexProperties = [
        'packed_position', 'packed_rotation', 'packed_scale', 'packed_color'
    ];
    const shProperties = new Array(45).fill('').map((_, i) => `f_rest_${i}`);
    const hasBaseElements = () => {
        return elements[0].name === 'chunk' &&
            elements[0].properties.every((p, i) => p.name === chunkProperties[i] && p.type === 'float') &&
            elements[1].name === 'vertex' &&
            elements[1].properties.every((p, i) => p.name === vertexProperties[i] && p.type === 'uint');
    };
    const hasSHElements = () => {
        return elements[2].name === 'sh' &&
            [9, 24, 45].indexOf(elements[2].properties.length) !== -1 &&
            elements[2].properties.every((p, i) => p.name === shProperties[i] && p.type === 'uchar');
    };
    return (elements.length === 2 && hasBaseElements()) || (elements.length === 3 && hasBaseElements() && hasSHElements());
};
// helper for streaming in chunks of data in a memory efficient way
class StreamBuf {
    reader;
    data;
    view;
    head = 0;
    tail = 0;
    constructor(reader) {
        this.reader = reader;
    }
    // read the next chunk of data
    async read() {
        const { value, done } = await this.reader.read();
        if (done) {
            throw new Error('Stream finished before end of header');
        }
        this.push(value);
    }
    // append data to the buffer
    push(data) {
        if (!this.data) {
            // first buffer
            this.data = data;
            this.view = new DataView(this.data.buffer);
            this.tail = data.length;
        }
        else {
            const remaining = this.tail - this.head;
            const newSize = remaining + data.length;
            if (this.data.length >= newSize) {
                // buffer is large enough to contain combined data
                if (this.head > 0) {
                    // shuffle existing data to index 0 and append the new data
                    this.data.copyWithin(0, this.head, this.tail);
                    this.data.set(data, remaining);
                    this.head = 0;
                    this.tail = newSize;
                }
                else {
                    // no shuffle needed, just append new data
                    this.data.set(data, this.tail);
                    this.tail += data.length;
                }
            }
            else {
                // buffer is too small and must grow
                const tmp = new Uint8Array(newSize);
                if (this.head > 0 || this.tail < this.data.length) {
                    // shuffle existing data to index 0 and append the new data
                    tmp.set(this.data.subarray(this.head, this.tail), 0);
                }
                else {
                    tmp.set(this.data, 0);
                }
                tmp.set(data, remaining);
                this.data = tmp;
                this.view = new DataView(this.data.buffer);
                this.head = 0;
                this.tail = newSize;
            }
        }
    }
    // remove the read data from the head of the buffer
    compact() {
        if (this.head > 0) {
            this.data.copyWithin(0, this.head, this.tail);
            this.tail -= this.head;
            this.head = 0;
        }
    }
    get remaining() {
        return this.tail - this.head;
    }
    // helpers for extracting data from head
    getInt8() {
        const result = this.view.getInt8(this.head);
        this.head++;
        return result;
    }
    getUint8() {
        const result = this.view.getUint8(this.head);
        this.head++;
        return result;
    }
    getInt16() {
        const result = this.view.getInt16(this.head, true);
        this.head += 2;
        return result;
    }
    getUint16() {
        const result = this.view.getUint16(this.head, true);
        this.head += 2;
        return result;
    }
    getInt32() {
        const result = this.view.getInt32(this.head, true);
        this.head += 4;
        return result;
    }
    getUint32() {
        const result = this.view.getUint32(this.head, true);
        this.head += 4;
        return result;
    }
    getFloat32() {
        const result = this.view.getFloat32(this.head, true);
        this.head += 4;
        return result;
    }
    getFloat64() {
        const result = this.view.getFloat64(this.head, true);
        this.head += 8;
        return result;
    }
}
class SplatCompressedIterator {
    read;
    constructor(gsplatData, p, r, s, c, sh) {
        const unpackUnorm = (value, bits) => {
            const t = (1 << bits) - 1;
            return (value & t) / t;
        };
        const unpack111011 = (result, value) => {
            result.x = unpackUnorm(value >>> 21, 11);
            result.y = unpackUnorm(value >>> 11, 10);
            result.z = unpackUnorm(value, 11);
        };
        const unpack8888 = (result, value) => {
            result.x = unpackUnorm(value >>> 24, 8);
            result.y = unpackUnorm(value >>> 16, 8);
            result.z = unpackUnorm(value >>> 8, 8);
            result.w = unpackUnorm(value, 8);
        };
        // unpack quaternion with 2,10,10,10 format (largest element, 3x10bit element)
        const unpackRot = (result, value) => {
            const norm = 1.0 / (Math.sqrt(2) * 0.5);
            const a = (unpackUnorm(value >>> 20, 10) - 0.5) * norm;
            const b = (unpackUnorm(value >>> 10, 10) - 0.5) * norm;
            const c = (unpackUnorm(value, 10) - 0.5) * norm;
            const m = Math.sqrt(1.0 - (a * a + b * b + c * c));
            switch (value >>> 30) {
                case 0:
                    result.set(a, b, c, m);
                    break;
                case 1:
                    result.set(m, b, c, a);
                    break;
                case 2:
                    result.set(b, m, c, a);
                    break;
                case 3:
                    result.set(b, c, m, a);
                    break;
            }
        };
        const lerp = (a, b, t) => a * (1 - t) + b * t;
        const { chunkData, vertexData, shData } = gsplatData.compressedData;
        const { chunkSize, shBands } = gsplatData;
        const shCoeffs = [3, 8, 15][shBands - 1];
        this.read = (i) => {
            const ci = Math.floor(i / 256) * chunkSize;
            if (p) {
                unpack111011(p, vertexData[i * 4 + 0]);
                p.x = lerp(chunkData[ci + 0], chunkData[ci + 3], p.x);
                p.y = lerp(chunkData[ci + 1], chunkData[ci + 4], p.y);
                p.z = lerp(chunkData[ci + 2], chunkData[ci + 5], p.z);
            }
            if (r) {
                unpackRot(r, vertexData[i * 4 + 1]);
            }
            if (s) {
                unpack111011(s, vertexData[i * 4 + 2]);
                s.x = lerp(chunkData[ci + 6], chunkData[ci + 9], s.x);
                s.y = lerp(chunkData[ci + 7], chunkData[ci + 10], s.y);
                s.z = lerp(chunkData[ci + 8], chunkData[ci + 11], s.z);
            }
            if (c) {
                unpack8888(c, vertexData[i * 4 + 3]);
                if (chunkSize > 12) {
                    c.x = lerp(chunkData[ci + 12], chunkData[ci + 15], c.x);
                    c.y = lerp(chunkData[ci + 13], chunkData[ci + 16], c.y);
                    c.z = lerp(chunkData[ci + 14], chunkData[ci + 17], c.z);
                }
            }
            if (sh && shBands > 0) {
                for (let j = 0; j < 3; ++j) {
                    for (let k = 0; k < 15; ++k) {
                        sh[j * 15 + k] = (k < shCoeffs) ? (shData[(i * 3 + j) * shCoeffs + k] * (8 / 255) - 4) : 0;
                    }
                }
            }
        };
    }
}
const decompress = (compressedData, elements) => {
    const members = [
        'x', 'y', 'z',
        'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity',
        'scale_0', 'scale_1', 'scale_2',
        'rot_0', 'rot_1', 'rot_2', 'rot_3'
    ];
    const getShBands = () => {
        const sizes = {
            3: 1,
            8: 2,
            15: 3
        };
        return sizes[compressedData.shData?.length / compressedData.numSplats / 3] ?? 0;
    };
    const getNumChunks = () => {
        return Math.ceil(compressedData.numSplats / 256);
    };
    const getChunkSize = () => {
        return compressedData.chunkData.length / getNumChunks();
    };
    const shBands = getShBands();
    const numSplats = compressedData.numSplats;
    // allocate spherical harmonics data
    if (shBands > 0) {
        const shMembers = [];
        for (let i = 0; i < 45; ++i) {
            shMembers.push(`f_rest_${i}`);
        }
        members.splice(members.indexOf('f_dc_0') + 1, 0, ...shMembers);
    }
    // allocate uncompressed data
    const data = {
        numPoints: numSplats,
        shDegree: shBands,
        antialiased: false,
        positions: new Float32Array(numSplats * 3),
        scales: new Float32Array(numSplats * 3),
        rotations: new Float32Array(numSplats * 4),
        alphas: new Float32Array(numSplats),
        colors: new Float32Array(numSplats * 3),
        sh: new Float32Array(numSplats * dimForDegree(shBands) * 3)
    };
    const p = new Vec3();
    const r = new Quat();
    const s = new Vec3();
    const c = new Vec4();
    const sh = shBands > 0 ? new Float32Array(45) : null;
    const iter = new SplatCompressedIterator({
        compressedData,
        chunkSize: getChunkSize(),
        shBands,
    }, p, r, s, c, sh);
    for (let i = 0; i < compressedData.numSplats; ++i) {
        iter.read(i);
        data.positions[i * 3 + 0] = p.x;
        data.positions[i * 3 + 1] = p.y;
        data.positions[i * 3 + 2] = p.z;
        data.rotations[i * 4 + 0] = r.x;
        data.rotations[i * 4 + 1] = r.y;
        data.rotations[i * 4 + 2] = r.z;
        data.rotations[i * 4 + 3] = r.w;
        data.scales[i * 3 + 0] = s.x;
        data.scales[i * 3 + 1] = s.y;
        data.scales[i * 3 + 2] = s.z;
        data.colors[i * 3 + 0] = (c.x - 0.5) / SH_C0;
        data.colors[i * 3 + 1] = (c.y - 0.5) / SH_C0;
        data.colors[i * 3 + 2] = (c.z - 0.5) / SH_C0;
        // convert opacity to log sigmoid taking into account infinities at 0 and 1
        data.alphas[i] = (c.w <= 0) ? -40 : (c.w >= 1) ? 40 : -Math.log(1 / c.w - 1);
        const shDim = dimForDegree(shBands);
        for (let j = 0; j < shBands; ++j) {
            for (let k = 0; k < shDim; ++k) {
                data.sh[(i * shDim + k) * 3 + j] = sh[j * shDim + k];
            }
        }
    }
    return data;
};
export async function loadCompressedPly(stream) {
    const reader = stream.getReader();
    // Read header
    /**
     * Searches for the first occurrence of a sequence within a buffer.
     * @example
     * find(new Uint8Array([1, 2, 3, 4]), new Uint8Array([3, 4])); // 2
     * @param {Uint8Array} buf - The buffer in which to search.
     * @param {Uint8Array} search - The sequence to search for.
     * @returns {number} The index of the first occurrence of the search sequence in the buffer, or -1 if not found.
     */
    const find = (buf, search) => {
        const endIndex = buf.length - search.length;
        let i, j;
        for (i = 0; i <= endIndex; ++i) {
            for (j = 0; j < search.length; ++j) {
                if (buf[i + j] !== search[j]) {
                    break;
                }
            }
            if (j === search.length) {
                return i;
            }
        }
        return -1;
    };
    /**
     * Checks if array 'a' starts with the same elements as array 'b'.
     * @example
     * startsWith(new Uint8Array([1, 2, 3, 4]), new Uint8Array([1, 2])); // true
     * @param {Uint8Array} a - The array to check against.
     * @param {Uint8Array} b - The array of elements to look for at the start of 'a'.
     * @returns {boolean} - True if 'a' starts with all elements of 'b', otherwise false.
     */
    const startsWith = (a, b) => {
        if (a.length < b.length) {
            return false;
        }
        for (let i = 0; i < b.length; ++i) {
            if (a[i] !== b[i]) {
                return false;
            }
        }
        return true;
    };
    const streamBuf = new StreamBuf(reader);
    let headerLength;
    while (true) {
        // get the next chunk of data
        /* eslint-disable no-await-in-loop */
        await streamBuf.read();
        // check magic bytes
        if (streamBuf.tail >= magicBytes.length && !startsWith(streamBuf.data, magicBytes)) {
            throw new Error('Invalid ply header');
        }
        // search for end-of-header marker
        headerLength = find(streamBuf.data, endHeaderBytes);
        if (headerLength !== -1) {
            break;
        }
    }
    // decode buffer header text and split into lines and remove comments
    const lines = new TextDecoder()
        .decode(streamBuf.data.subarray(0, headerLength))
        .split('\n')
        .filter(line => !line.startsWith('comment '));
    // decode header and build element and property list
    const { elements, format } = parseHeader(lines);
    if (!isCompressedPly(elements)) {
        throw new Error('Invalid ply header, not a compressed ply file.');
    }
    // check format is supported
    if (format !== 'binary_little_endian' && format !== 'binary_big_endian') {
        throw new Error('Unsupported ply format');
    }
    streamBuf.head = headerLength + endHeaderBytes.length;
    streamBuf.compact();
    // Read compressed ply data
    const numChunks = elements[0].count;
    const numChunkProperties = elements[0].properties.length;
    const numVertices = elements[1].count;
    // evaluate the storage size for the given count (this must match the
    // texture size calculation in GSplatCompressed).
    const evalStorageSize = (count) => {
        const width = Math.ceil(Math.sqrt(count));
        const height = Math.ceil(count / width);
        return width * height;
    };
    // allocate result
    const result = {
        numSplats: numVertices,
        chunkData: new Float32Array(numChunks * numChunkProperties),
        vertexData: new Uint32Array(evalStorageSize(numVertices) * 4),
    };
    // read length bytes of data into buffer
    const read = async (buffer, length) => {
        const target = new Uint8Array(buffer);
        let cursor = 0;
        while (cursor < length) {
            while (streamBuf.remaining === 0) {
                /* eslint-disable no-await-in-loop */
                await streamBuf.read();
            }
            const toCopy = Math.min(length - cursor, streamBuf.remaining);
            const src = streamBuf.data;
            for (let i = 0; i < toCopy; ++i) {
                target[cursor++] = src[streamBuf.head++];
            }
        }
    };
    // read chunk data
    await read(result.chunkData.buffer, numChunks * numChunkProperties * 4);
    // read packed vertices
    await read(result.vertexData.buffer, numVertices * 4 * 4);
    // read sh data
    if (elements.length === 3) {
        result.shData = new Uint8Array(elements[2].count * elements[2].properties.length);
        await read(result.shData.buffer, result.shData.byteLength);
    }
    // Decompress
    const data = decompress(result, elements);
    return data;
}
