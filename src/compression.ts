const createStream = (data: Uint8Array): ReadableStream<Uint8Array> => {
    return new ReadableStream({
        async start(controller) {
            controller.enqueue(data);
            controller.close();
        },
    })
}

export async function decompressGzipped(data: Uint8Array): Promise<Uint8Array> {
    try {
        const stream = createStream(data);
        if (!stream) throw new Error('Failed to create stream from data');

        return await decompressGzipStream(stream);
    } catch (error) {
        console.error('Error decompressing gzipped data:', error);
        throw error;
    }
}

export async function decompressGzipStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const decompressor = new DecompressionStream('gzip') as TransformStream<Uint8Array, Uint8Array>;
    const decompressedStream = stream.pipeThrough(decompressor);
    const response = new Response(decompressedStream);
    const buffer = await response.arrayBuffer();

    return new Uint8Array(buffer);
}

export async function compressGzipped(data: Uint8Array): Promise<Uint8Array> {
    try {
        const stream = createStream(data);
        const compressor = new CompressionStream('gzip') as TransformStream<Uint8Array, Uint8Array>;
        const compressedStream = stream.pipeThrough(compressor);
        const response = new Response(compressedStream);
        const buffer = await response.arrayBuffer();

        return new Uint8Array(buffer);
    } catch (error) {
        console.error('Error compressing gzipped data:', error);
        throw error;
    }
}
