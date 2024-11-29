export declare function decompressGzipped(data: Uint8Array): Promise<Uint8Array>;
export declare function decompressGzipStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array>;
export declare function compressGzipped(data: Uint8Array): Promise<Uint8Array>;
