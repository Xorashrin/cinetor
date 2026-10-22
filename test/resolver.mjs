import path from 'node:path';
import { pathToFileURL } from 'node:url';

const mockAsyncStorageUrl = pathToFileURL(path.resolve('./test/mocks/async-storage.mjs')).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@react-native-async-storage/async-storage') {
    return {
      format: 'module',
      shortCircuit: true,
      url: mockAsyncStorageUrl,
    };
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    try {
      return await nextResolve(specifier, context);
    } catch (err) {
      if (err.code === 'ERR_MODULE_NOT_FOUND') {
        try {
          return await nextResolve(`${specifier}.ts`, context);
        } catch {}
        try {
          return await nextResolve(`${specifier}/index.ts`, context);
        } catch {}
      }
      throw err;
    }
  }
  return nextResolve(specifier, context);
}
