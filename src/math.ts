import { Vec3f, Quat4f, Half } from './types.js';

export const PI = Math.PI;

export function halfToFloat(h: Half): number {
    const sgn = (h >> 15) & 0x1;
    const exponent = (h >> 10) & 0x1f;
    const mantissa = h & 0x3ff;

    const signMul = sgn === 1 ? -1.0 : 1.0;
    if (exponent === 0) {
        return signMul * Math.pow(2, -14) * mantissa / 1024;
    }

    if (exponent === 31) {
        return mantissa !== 0 ? NaN : signMul * Infinity;
    }

    return signMul * Math.pow(2, exponent - 15) * (1 + mantissa / 1024);
}

export function floatToHalf(f: number): Half {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setFloat32(0, f);
    const f32 = view.getUint32(0);

    const sign = (f32 >> 31) & 0x01;
    const exponent = (f32 >> 23) & 0xff;
    const mantissa = f32 & 0x7fffff;

    if (exponent === 0xff) {
        if (mantissa === 0) {
            return (sign << 15) | 0x7c00;
        }
        return (sign << 15) | 0x7c01;
    }

    const centeredExp = exponent - 127;
    if (centeredExp > 15) {
        return (sign << 15) | 0x7c00;
    }

    if (centeredExp > -15) {
        return (sign << 15) | ((centeredExp + 15) << 10) | (mantissa >> 13);
    }

    const fullMantissa = 0x800000 | mantissa;
    const shift = -(centeredExp + 14);
    const newMantissa = fullMantissa >> shift;
    return (sign << 15) | (newMantissa >> 13);
}

export function axisAngleQuat(scaledAxis: Vec3f): Quat4f {
    const [a0, a1, a2] = scaledAxis;
    const thetaSquared = a0 * a0 + a1 * a1 + a2 * a2;

    if (thetaSquared > 0) {
        const theta = Math.sqrt(thetaSquared);
        const halfTheta = theta * 0.5;
        const k = Math.sin(halfTheta) / theta;
        return normalized([Math.cos(halfTheta), a0 * k, a1 * k, a2 * k]) as Quat4f;
    }

    const k = 0.5;
    return normalized([1.0, a0 * k, a1 * k, a2 * k]) as Quat4f;
}

export function isVec3f(v: number[]): v is Vec3f {
    return v.length === 3;
}

export function isQuat4f(v: number[]): v is Quat4f {
    return v.length === 4;
}

export function vec3f(data: number[]): Vec3f {
    return [data[0], data[1], data[2]];
}

export function quat4f(data: number[]): Quat4f {
    return [data[0], data[1], data[2], data[3]];
}

export function dot(a: Vec3f, b: Vec3f): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function squaredNorm(v: Vec3f | Quat4f): number {
    return v.reduce((sum, val) => sum + val * val, 0);
}

export function norm(v: Vec3f | Quat4f): number {
    return Math.sqrt(squaredNorm(v));
}

export function normalized<T extends Vec3f | Quat4f>(v: T): T {
    const n = norm(v);
    return v.map(x => x / n) as T;
}

// Quaternion multiplication with a vector
export function timesVec3(q: Quat4f, p: Vec3f): Vec3f {
    const [w, x, y, z] = q;
    const [vx, vy, vz] = p;
    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;
    const wx2 = w * x2;
    const wy2 = w * y2;
    const wz2 = w * z2;
    const xx2 = x * x2;
    const xy2 = x * y2;
    const xz2 = x * z2;
    const yy2 = y * y2;
    const yz2 = y * z2;
    const zz2 = z * z2;

    return [
        vx * (1.0 - (yy2 + zz2)) + vy * (xy2 - wz2) + vz * (xz2 + wy2),
        vx * (xy2 + wz2) + vy * (1.0 - (xx2 + zz2)) + vz * (yz2 - wx2),
        vx * (xz2 - wy2) + vy * (yz2 + wx2) + vz * (1.0 - (xx2 + yy2))
    ];
}

// Quaternion multiplication
export function timesQuat(a: Quat4f, b: Quat4f): Quat4f {
    const [w, x, y, z] = a;
    const [qw, qx, qy, qz] = b;
    return normalized([
        w * qw - x * qx - y * qy - z * qz,
        w * qx + x * qw + y * qz - z * qy,
        w * qy - x * qz + y * qw + z * qx,
        w * qz + x * qy - y * qx + z * qw
    ]);
}

// Scalar multiplication
export function timesScalar<T extends Vec3f | Quat4f>(v: T, s: number): T {
    return v.map(x => x * s) as T;
}

// Vector/quaternion addition
export function plus<T extends Vec3f | Quat4f>(a: T, b: T): T {
    return a.map((x, i) => x + b[i]) as T;
}

// Convert Vec3f to Quat4f with w component
export function vec3ToQuat4(v: Vec3f, w: number): Quat4f {
    return [w, v[0], v[1], v[2]];  // w first, then xyz
}

export function quatToVec3(q: Quat4f): Vec3f {
    return [q[1], q[2], q[3]];  // Skip w, take xyz
}
/**
 * Minimal vector/quaternion types.
 *
 * These exist so the library has no runtime dependency on the playcanvas engine,
 * which used to be pulled in whole for the handful of field accesses the
 * compressed-PLY code makes. Only what that code actually uses is implemented.
 */
export class Vec3 {
    x = 0;
    y = 0;
    z = 0;

    constructor(x = 0, y = 0, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    set(x: number, y: number, z: number): this {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    }
}

export class Vec4 {
    x = 0;
    y = 0;
    z = 0;
    w = 0;

    constructor(x = 0, y = 0, z = 0, w = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }

    set(x: number, y: number, z: number, w: number): this {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
        return this;
    }
}

export class Quat {
    x = 0;
    y = 0;
    z = 0;
    w = 1;

    constructor(x = 0, y = 0, z = 0, w = 1) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }

    set(x: number, y: number, z: number, w: number): this {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
        return this;
    }

    /** Scale to unit length in place. A zero-length quaternion becomes identity. */
    normalize(): this {
        const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
        if (len === 0) {
            return this.set(0, 0, 0, 1);
        }
        const inv = 1 / len;
        this.x *= inv;
        this.y *= inv;
        this.z *= inv;
        this.w *= inv;
        return this;
    }
}
