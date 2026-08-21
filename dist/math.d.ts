import { Vec3f, Quat4f, Half } from './types.js';
export declare const PI: number;
export declare function halfToFloat(h: Half): number;
export declare function floatToHalf(f: number): Half;
export declare function axisAngleQuat(scaledAxis: Vec3f): Quat4f;
export declare function isVec3f(v: number[]): v is Vec3f;
export declare function isQuat4f(v: number[]): v is Quat4f;
export declare function vec3f(data: number[]): Vec3f;
export declare function quat4f(data: number[]): Quat4f;
export declare function dot(a: Vec3f, b: Vec3f): number;
export declare function squaredNorm(v: Vec3f | Quat4f): number;
export declare function norm(v: Vec3f | Quat4f): number;
export declare function normalized<T extends Vec3f | Quat4f>(v: T): T;
export declare function timesVec3(q: Quat4f, p: Vec3f): Vec3f;
export declare function timesQuat(a: Quat4f, b: Quat4f): Quat4f;
export declare function timesScalar<T extends Vec3f | Quat4f>(v: T, s: number): T;
export declare function plus<T extends Vec3f | Quat4f>(a: T, b: T): T;
export declare function vec3ToQuat4(v: Vec3f, w: number): Quat4f;
export declare function quatToVec3(q: Quat4f): Vec3f;
/**
 * Minimal vector/quaternion types.
 *
 * These exist so the library has no runtime dependency on the playcanvas engine,
 * which used to be pulled in whole for the handful of field accesses the
 * compressed-PLY code makes. Only what that code actually uses is implemented.
 */
export declare class Vec3 {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
    set(x: number, y: number, z: number): this;
}
export declare class Vec4 {
    x: number;
    y: number;
    z: number;
    w: number;
    constructor(x?: number, y?: number, z?: number, w?: number);
    set(x: number, y: number, z: number, w: number): this;
}
export declare class Quat {
    x: number;
    y: number;
    z: number;
    w: number;
    constructor(x?: number, y?: number, z?: number, w?: number);
    set(x: number, y: number, z: number, w: number): this;
    /** Scale to unit length in place. A zero-length quaternion becomes identity. */
    normalize(): this;
}
