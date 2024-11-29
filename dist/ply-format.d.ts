import { GaussianCloud } from './types.js';
export declare function loadPly(stream: ReadableStream<Uint8Array>): Promise<GaussianCloud>;
export declare function serializePly(data: GaussianCloud): ArrayBuffer;
