export declare const SPZ_MAGIC = 1347635022;
export declare const SPZ_VERSION = 2;
export declare const FLAG_ANTIALIASED = 1;
export declare const COLOR_SCALE = 0.15;
export interface PackedGaussiansHeader {
    magic: number;
    version: number;
    numPoints: number;
    shDegree: number;
    fractionalBits: number;
    flags: number;
    reserved: number;
}
export declare function degreeForDim(dim: number): number;
export declare function dimForDegree(degree: number): number;
