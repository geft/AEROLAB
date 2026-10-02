export const START: number;
export function message(number: number, fields: Array<[number, number, number | string | number[]]>, options?: { local?: number; bigEndian?: boolean; developer?: Array<{ id: number; index: number; bytes: Buffer }> }): Buffer;
export function sealFit(input: Buffer): Buffer;
export function fitFile(chunks: Buffer[]): Buffer;
export function richFit(): Buffer;
