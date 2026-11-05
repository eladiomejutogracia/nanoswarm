/**
 * The number a float32 shader holds for a literal, so the CPU and the GPU start from the same constant.
 * JavaScript computes in float64; the GPU in float32. A literal like 1e39 or 1e-320 has no float32 value.
 */

/** Smallest normal float32; GPUs may flush anything smaller to zero. */
export const FLOAT32_MIN_NORMAL = 1.1754943508222875e-38;

/** Whether `value` is too large to be a float32 (it would become Infinity). */
export const overflowsFloat32 = (value: number): boolean => !Number.isFinite(Math.fround(value));

/** `value` as a float32 shader holds it: rounded, with values below the smallest normal float32 flushed to 0. Throws if it overflows. */
export function float32Constant(value: number): number {
    const rounded = Math.fround(value);
    if (!Number.isFinite(rounded)) throw new RangeError(`${value} does not fit in a float32`);
    return Math.abs(rounded) < FLOAT32_MIN_NORMAL ? 0 : rounded;
}

/** The shortest decimal text that a shader reads back as exactly this float32. */
export function float32Text(value: number): string {
    const exact = float32Constant(value);
    if (exact === 0) return '0';
    for (let digits = 1; digits <= 9; digits++) {
        const exponential = exact.toExponential(digits - 1);
        if (Math.fround(Number(exponential)) !== exact) continue;
        const magnitude = Math.abs(exact);
        if (magnitude >= 1e-4 && magnitude < 1e9) return String(Number(exponential));
        return exponential.replace(/\.?0+e/, 'e');
    }
    throw new Error('unreachable: 9 digits always identify a float32');
}
