# Library to convert gaussian splats between PLY and SPZ formats

Based on the [original C++ library](https://github.com/nianticlabs/spz).

## Installation

Install directly from github:

```bash
npm install github:ludovit-as/spz-js
```

## Example (Node.js)

```javascript
import {
    loadPly,
    loadSpz
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