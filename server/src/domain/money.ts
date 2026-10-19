/** Decimal helpers (decimal.js, 28 significant digits). Money is NEVER a float. */
import { Decimal as DecimalBase } from 'decimal.js';

export const Decimal = DecimalBase.clone({ precision: 28, rounding: DecimalBase.ROUND_HALF_EVEN });
export const ZERO = new Decimal(0);
export type Decimal = InstanceType<typeof Decimal>;
export const HALF_UP = DecimalBase.ROUND_HALF_UP;
export const HALF_EVEN = DecimalBase.ROUND_HALF_EVEN;

/** quantize(Decimal("0.01"), ROUND_HALF_UP) */
export const quantizeMoney = (x: Decimal): Decimal => x.toDecimalPlaces(2, HALF_UP);
/** quantize(Decimal("0.0001")) — default rounding is ROUND_HALF_EVEN (banker.s rounding) */
export const quantizeRate = (x: Decimal): Decimal => x.toDecimalPlaces(4, HALF_EVEN);
/** str(Decimal) with fixed notation and the scale kept (e.g. "1234.50"). */
export const decStr = (x: Decimal, dp = 2): string => x.toFixed(dp);
