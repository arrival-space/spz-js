// Tests for the SPZ v4 container reader.
//
// There is no v4 writer here (fzstd decompresses only), so the fixtures are built
// with Node's zstd: take the attribute streams the library's own packer produces,
// re-encode the rotations in the v3/v4 smallest-three form, and wrap them in a v4
// container (32-byte plaintext header + table of contents + one ZSTD frame per
// attribute). Loading that back must agree with the v2 path, whose bytes are the
// same, so any difference is a v4 reader bug.
//
// Run with: npm test

import { zstdCompressSync } from 'zlib';
import { loadSpz, serializeSpz, packGaussians, SPZ_MAGIC } from '../dist/index.js';

let failed = false;
const ok = (pass, label, detail = '') => {
    if (!pass) failed = true;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
};

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const dimForDegree = degree => [0, 3, 8, 15, 24][degree];

/** Deterministic pseudo-random splat cloud. */
const makeCloud = (numPoints, shDegree, shDim = dimForDegree(shDegree)) => {
    let seed = 12345;
    const rnd = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };

    const cloud = {
        numPoints,
        shDegree,
        antialiased: true,
        positions: new Float32Array(numPoints * 3),
        scales: new Float32Array(numPoints * 3),
        rotations: new Float32Array(numPoints * 4),
        alphas: new Float32Array(numPoints),
        colors: new Float32Array(numPoints * 3),
        sh: new Float32Array(numPoints * shDim * 3)
    };

    for (let i = 0; i < numPoints; i++) {
        for (let c = 0; c < 3; c++) {
            cloud.positions[i * 3 + c] = (rnd() - 0.5) * 20;
            cloud.scales[i * 3 + c] = -5 + rnd() * 4;
            cloud.colors[i * 3 + c] = (rnd() - 0.5) * 2;
        }
        let q = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
        const n = Math.hypot(...q);
        q = q.map(v => v / n);
        cloud.rotations.set(q, i * 4);
        cloud.alphas[i] = (rnd() - 0.5) * 6;
        for (let k = 0; k < shDim * 3; k++) cloud.sh[i * shDim * 3 + k] = rnd() - 0.5;
    }
    return cloud;
};

const SQRT1_2 = 1 / Math.sqrt(2);
const MASK = (1 << 9) - 1;

/** Encode xyzw quaternions in the v3/v4 smallest-three form, 4 bytes each. */
const packSmallestThree = (rotations, numPoints) => {
    const out = new Uint8Array(numPoints * 4);
    for (let i = 0; i < numPoints; i++) {
        let q = [rotations[i * 4], rotations[i * 4 + 1], rotations[i * 4 + 2], rotations[i * 4 + 3]];
        let largest = 0;
        for (let k = 1; k < 4; k++) if (Math.abs(q[k]) > Math.abs(q[largest])) largest = k;
        if (q[largest] < 0) q = q.map(v => -v);

        let word = largest >>> 0;
        // written high index first, mirroring the reader's reverse walk
        for (let k = 0; k < 4; k++) {
            if (k === largest) continue;
            const mag = Math.round(Math.min(Math.abs(q[k]) / SQRT1_2, 1) * MASK);
            const neg = q[k] < 0 ? 1 : 0;
            word = ((word << 10) >>> 0 | ((neg << 9) | mag)) >>> 0;
        }
        out[i * 4 + 0] = word & 0xff;
        out[i * 4 + 1] = (word >>> 8) & 0xff;
        out[i * 4 + 2] = (word >>> 16) & 0xff;
        out[i * 4 + 3] = (word >>> 24) & 0xff;
    }
    return out;
};

/** Wrap packed attribute streams in a v4 container. */
const buildV4 = (packed, rotations, { numPoints, shDegree, tocGap = 0 }) => {
    const streams = [packed.positions, packed.alphas, packed.colors, packed.scales, rotations, packed.sh]
        .filter(s => s.length > 0);
    const frames = streams.map(s => zstdCompressSync(Buffer.from(s)));

    const HEADER = 32;
    const tocOffset = HEADER + tocGap;
    const tocSize = frames.length * 16;
    const buf = Buffer.alloc(tocOffset + tocSize + frames.reduce((a, f) => a + f.length, 0));

    buf.writeUInt32LE(SPZ_MAGIC, 0);
    buf.writeUInt32LE(4, 4);
    buf.writeUInt32LE(numPoints, 8);
    buf.writeUInt8(shDegree, 12);
    buf.writeUInt8(packed.fractionalBits, 13);
    buf.writeUInt8(tocGap > 0 ? 0x1 | 0x2 : 0x1, 14); // antialiased (+ has-extensions)
    buf.writeUInt8(frames.length, 15);
    buf.writeUInt32LE(tocOffset, 16);

    let off = tocOffset + tocSize;
    frames.forEach((f, i) => {
        buf.writeBigUInt64LE(BigInt(f.length), tocOffset + i * 16);
        buf.writeBigUInt64LE(BigInt(streams[i].length), tocOffset + i * 16 + 8);
        f.copy(buf, off);
        off += f.length;
    });
    return buf;
};

/** Largest component-wise difference, ignoring an overall quaternion sign flip. */
const quatDiff = (a, b, numPoints) => {
    let worst = 0;
    for (let i = 0; i < numPoints; i++) {
        const p = a.subarray(i * 4, i * 4 + 4);
        const q = b.subarray(i * 4, i * 4 + 4);
        const s = p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3] < 0 ? -1 : 1;
        for (let k = 0; k < 4; k++) worst = Math.max(worst, Math.abs(p[k] - s * q[k]));
    }
    return worst;
};

const maxDiff = (a, b) => {
    if (a.length !== b.length) return Infinity;
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
};

// ---------------------------------------------------------------------------
// v4 vs v2: identical attribute bytes must decode identically
// ---------------------------------------------------------------------------

console.log('\n# v4 round trip (SH degree 2)');
{
    const NUM = 500;
    const cloud = makeCloud(NUM, 2);
    const fromV2 = await loadSpz(await serializeSpz(cloud));
    const packed = packGaussians(cloud);
    const v4 = buildV4(packed, packSmallestThree(cloud.rotations, NUM), { numPoints: NUM, shDegree: 2 });
    const fromV4 = await loadSpz(new Uint8Array(v4));

    ok(fromV4.numPoints === NUM, 'numPoints', `${fromV4.numPoints}`);
    ok(fromV4.shDegree === 2, 'shDegree', `${fromV4.shDegree}`);
    ok(fromV4.antialiased === true, 'antialiased flag');
    ok(maxDiff(fromV2.positions, fromV4.positions) === 0, 'positions match v2 exactly');
    ok(maxDiff(fromV2.scales, fromV4.scales) === 0, 'scales match v2 exactly');
    ok(maxDiff(fromV2.alphas, fromV4.alphas) === 0, 'alphas match v2 exactly');
    ok(maxDiff(fromV2.colors, fromV4.colors) === 0, 'colors match v2 exactly');
    ok(maxDiff(fromV2.sh, fromV4.sh) === 0, 'sh match v2 exactly');

    // v4 keeps all four quaternion components at 9 bits, so it should land very
    // close to the source.
    const srcErr = quatDiff(cloud.rotations, fromV4.rotations, NUM);
    ok(srcErr <= 5e-3, 'rotations vs source', srcErr.toExponential(2));

    // Against v2 the bar is much looser, and that is v2's doing: it stores xyz at
    // 8 bits and DERIVES w as sqrt(1 - x^2 - y^2 - z^2), whose slope blows up as
    // w -> 0, so a half-step error on xyz can land ~0.08 off in w.
    const v2Err = quatDiff(fromV2.rotations, fromV4.rotations, NUM);
    ok(v2Err <= 0.1, 'rotations vs v2 (v2 derives w)', v2Err.toExponential(2));
}

// ---------------------------------------------------------------------------
// SH degree 0: the SH stream is omitted entirely, so the file has 5 streams
// ---------------------------------------------------------------------------

console.log('\n# v4 with no spherical harmonics');
{
    const NUM = 64;
    const cloud = makeCloud(NUM, 0);
    const packed = packGaussians(cloud);
    const v4 = buildV4(packed, packSmallestThree(cloud.rotations, NUM), { numPoints: NUM, shDegree: 0 });

    ok(v4.readUInt8(15) === 5, 'fixture has 5 streams, not 6');
    const cloud4 = await loadSpz(new Uint8Array(v4));
    ok(cloud4.numPoints === NUM, 'numPoints');
    ok(cloud4.shDegree === 0, 'shDegree');
    ok(cloud4.sh.length === 0, 'sh is empty');
    ok(quatDiff(cloud.rotations, cloud4.rotations, NUM) <= 5e-3, 'rotations vs source');
}

// ---------------------------------------------------------------------------
// SH degree 4 exists in v4 but not in this library's cloud - read it at degree 3
// ---------------------------------------------------------------------------

console.log('\n# v4 with SH degree 4 (truncated to 3)');
{
    const NUM = 32;
    const STORED_DIM = 24;
    const cloud = makeCloud(NUM, 4, STORED_DIM);
    // packGaussians tops out at degree 3, so quantize the degree-4 SH by hand
    const packed = packGaussians({ ...cloud, shDegree: 0, sh: new Float32Array(0) });
    packed.sh = new Uint8Array(NUM * STORED_DIM * 3);
    for (let i = 0; i < packed.sh.length; i++) {
        packed.sh[i] = Math.min(255, Math.max(0, Math.round(cloud.sh[i] * 128 + 128)));
    }
    const v4 = buildV4(packed, packSmallestThree(cloud.rotations, NUM), { numPoints: NUM, shDegree: 4 });

    const cloud4 = await loadSpz(new Uint8Array(v4));
    ok(cloud4.shDegree === 3, 'reported as degree 3', `${cloud4.shDegree}`);
    ok(cloud4.sh.length === NUM * 15 * 3, 'sh truncated to 15 coefficients', `${cloud4.sh.length}`);

    // the kept coefficients must be the FIRST 15 of each splat, not a reslice
    let worst = 0;
    for (let i = 0; i < NUM; i++) {
        for (let k = 0; k < 15 * 3; k++) {
            const expected = (packed.sh[i * STORED_DIM * 3 + k] - 128) / 128;
            worst = Math.max(worst, Math.abs(cloud4.sh[i * 15 * 3 + k] - expected));
        }
    }
    ok(worst === 0, 'kept coefficients are the first 15 per splat');
}

// ---------------------------------------------------------------------------
// extensions are skipped via the table of contents offset
// ---------------------------------------------------------------------------

console.log('\n# v4 with extension records');
{
    const NUM = 64;
    const cloud = makeCloud(NUM, 1);
    const packed = packGaussians(cloud);
    const plain = buildV4(packed, packSmallestThree(cloud.rotations, NUM), { numPoints: NUM, shDegree: 1 });
    const withExt = buildV4(packed, packSmallestThree(cloud.rotations, NUM),
        { numPoints: NUM, shDegree: 1, tocGap: 48 });

    const a = await loadSpz(new Uint8Array(plain));
    const b = await loadSpz(new Uint8Array(withExt));
    ok(maxDiff(a.positions, b.positions) === 0, 'positions unaffected by the extension block');
    ok(maxDiff(a.sh, b.sh) === 0, 'sh unaffected by the extension block');
}

// ---------------------------------------------------------------------------
// legacy versions still load
// ---------------------------------------------------------------------------

console.log('\n# legacy containers');
{
    const NUM = 128;
    const cloud = makeCloud(NUM, 1);
    const v2 = await loadSpz(await serializeSpz(cloud));
    ok(v2.numPoints === NUM && v2.shDegree === 1, 'v2 still loads');

    // a v3 file is a v2 file with the smallest-three rotations and version 3
    const packed = packGaussians(cloud);
    packed.rotations = packSmallestThree(cloud.rotations, NUM);
    const parts = [packed.positions, packed.alphas, packed.colors, packed.scales, packed.rotations, packed.sh];
    const body = Buffer.alloc(16 + parts.reduce((a, p) => a + p.length, 0));
    body.writeUInt32LE(SPZ_MAGIC, 0);
    body.writeUInt32LE(3, 4);
    body.writeUInt32LE(NUM, 8);
    body.writeUInt8(1, 12);
    body.writeUInt8(packed.fractionalBits, 13);
    body.writeUInt8(0, 14);
    body.writeUInt8(0, 15);
    let off = 16;
    for (const p of parts) {
        Buffer.from(p).copy(body, off);
        off += p.length;
    }
    const { gzipSync } = await import('zlib');
    const v3 = await loadSpz(new Uint8Array(gzipSync(body)));
    ok(v3.numPoints === NUM, 'v3 still loads');
    ok(quatDiff(cloud.rotations, v3.rotations, NUM) <= 5e-3, 'v3 rotations vs source',
        quatDiff(cloud.rotations, v3.rotations, NUM).toExponential(2));
}

// ---------------------------------------------------------------------------
// malformed input is rejected with an error, not a null dereference
// ---------------------------------------------------------------------------

console.log('\n# rejections');
{
    const NUM = 64;
    const cloud = makeCloud(NUM, 1);
    const packed = packGaussians(cloud);
    const good = buildV4(packed, packSmallestThree(cloud.rotations, NUM), { numPoints: NUM, shDegree: 1 });

    const rejects = async (label, bytes) => {
        try {
            await loadSpz(bytes);
            ok(false, label, 'accepted');
        } catch (e) {
            ok(true, label, e.message);
        }
    };

    await rejects('truncated file', new Uint8Array(good.subarray(0, 40)));

    const badVersion = Buffer.from(good);
    badVersion.writeUInt32LE(9, 4);
    await rejects('unknown version', new Uint8Array(badVersion));

    const badMagic = Buffer.from(good);
    badMagic.writeUInt32LE(0x12345678, 0);
    await rejects('bad magic', new Uint8Array(badMagic));

    const badStreamCount = Buffer.from(good);
    badStreamCount.writeUInt8(3, 15);
    await rejects('wrong stream count', new Uint8Array(badStreamCount));

    const badToc = Buffer.from(good);
    badToc.writeUInt32LE(good.length - 4, 16);
    await rejects('table of contents past the end', new Uint8Array(badToc));

    const corruptFrame = Buffer.from(good);
    corruptFrame[corruptFrame.length - 8] ^= 0xff;
    await rejects('corrupt ZSTD frame', new Uint8Array(corruptFrame));
}

console.log(failed ? '\nFAILED' : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
