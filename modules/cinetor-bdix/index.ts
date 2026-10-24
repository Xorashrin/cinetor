import { requireOptionalNativeModule } from 'expo';
import type { CinetorBdixNative } from '../../src/providers/bdix/transport';

/** Null on Expo Go, web, and iOS. Importing this module does not perform network I/O. */
export default requireOptionalNativeModule<CinetorBdixNative>('CinetorBdix');
export type { CinetorBdixNative } from '../../src/providers/bdix/transport';
