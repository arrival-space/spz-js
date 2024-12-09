# Library to convert gaussian splats between PLY and SPZ formats

Based on the [original C++ library](https://github.com/nianticlabs/spz).

## Installation

Install directly from npm:

```bash
npm install spz-js
```

## Example (Node.js)

```javascript
import {
    createReadStream,
    readFileSync,
    writeFileSync,
    unlinkSync
} from 'fs';
import { Readable } from 'stream';
import path from 'path';

import {
    loadPly,
    loadSpz,
    serializePly,
    serializeSpz
} from 'spz-js';

// Helper function to load either SPZ or PLY files
const loadFile = async (file) => {
    const extension = path.extname(file);
    if (extension === '.spz') {
        const fileBuffer = readFileSync(file);
        return await loadSpz(fileBuffer);
    } else if (extension === '.ply') {
        const fileStream = createReadStream(file);
        const webStream = Readable.toWeb(fileStream);
        return await loadPly(webStream);
    }
    throw new Error(`Unsupported file extension: ${extension}`);
};

const gs = await loadFile("gs.ply"); // or gs.spz

const plyData = serializePly(gs);
writeFileSync("gs.ply", Buffer.from(plyData));

const spzData = await serializeSpz(gs);
writeFileSync("gs.spz", Buffer.from(spzData));
```

## Example (Browser)

```javascript
import {
    loadPly,
    loadSpz
} from 'spz-js';

const loadFile = async (url) => {
    const response = await fetch(url);
    const extension = url.split('.').pop();
    
    if (extension === 'spz') {
        const buffer = await response.arrayBuffer();
        return await loadSpz(buffer);
    } else if (extension === 'ply') {
        return await loadPly(response.body);
    }
    throw new Error(`Unsupported file extension: ${extension}`);
};
```