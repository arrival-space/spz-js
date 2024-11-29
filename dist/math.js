export const PI = Math.PI;
export function halfToFloat(h) {
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
export function floatToHalf(f) {
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
export function axisAngleQuat(scaledAxis) {
    const [a0, a1, a2] = scaledAxis;
    const thetaSquared = a0 * a0 + a1 * a1 + a2 * a2;
    if (thetaSquared > 0) {
        const theta = Math.sqrt(thetaSquared);
        const halfTheta = theta * 0.5;
        const k = Math.sin(halfTheta) / theta;
        return normalized([Math.cos(halfTheta), a0 * k, a1 * k, a2 * k]);
    }
    const k = 0.5;
    return normalized([1.0, a0 * k, a1 * k, a2 * k]);
}
export function isVec3f(v) {
    return v.length === 3;
}
export function isQuat4f(v) {
    return v.length === 4;
}
export function vec3f(data) {
    return [data[0], data[1], data[2]];
}
export function quat4f(data) {
    return [data[0], data[1], data[2], data[3]];
}
export function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function squaredNorm(v) {
    return v.reduce((sum, val) => sum + val * val, 0);
}
export function norm(v) {
    return Math.sqrt(squaredNorm(v));
}
export function normalized(v) {
    const n = norm(v);
    return v.map(x => x / n);
}
// Quaternion multiplication with a vector
export function timesVec3(q, p) {
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
export function timesQuat(a, b) {
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
export function timesScalar(v, s) {
    return v.map(x => x * s);
}
// Vector/quaternion addition
export function plus(a, b) {
    return a.map((x, i) => x + b[i]);
}
// Convert Vec3f to Quat4f with w component
export function vec3ToQuat4(v, w) {
    return [w, v[0], v[1], v[2]]; // w first, then xyz
}
export function quatToVec3(q) {
    return [q[1], q[2], q[3]]; // Skip w, take xyz
}
