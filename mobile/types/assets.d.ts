/**
 * Ambient declarations for the non-code assets Metro resolves.
 *
 * Metro turns these into modules at bundle time; tsc has no idea they exist
 * without this file, and `expo lint`/`tsc` would otherwise fail on every
 * stylesheet and image import.
 */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

declare module '*.css';

declare module '*.png' {
  const value: number;
  export default value;
}

declare module '*.jpg' {
  const value: number;
  export default value;
}

declare module '*.onnx' {
  const value: number;
  export default value;
}
