import { randomBytes } from 'node:crypto';

/** prefix_<12 hex>, stable id shape used across the API. */
export const newId = (prefix: string): string => `${prefix}_${randomBytes(6).toString('hex')}`;
