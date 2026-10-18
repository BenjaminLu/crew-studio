/** Studio-owned capability listeners always use these ports. Tests may never connect,
 * bind or accept on them, including listeners created after the test snapshot. */
export const BROKER_PORTS: readonly number[] = Object.freeze(Array.from({ length: 64 }, (_, i) => 43000 + i));
export const DEFAULT_STUDIO_PORT = 4210;
