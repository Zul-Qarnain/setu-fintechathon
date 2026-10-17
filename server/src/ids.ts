import { randomBytes } from 'node:crypto';

/** prefix_<12 hex>, same shape as Python new_id(). */
export const newId = (prefix: string): string => `${prefix}_${randomBytes(6).toString('hex')}`;
