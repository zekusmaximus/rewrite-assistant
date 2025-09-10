declare module 'js-sha256' {
  // Minimal typings to satisfy current project usage
  export function sha256(message: string | ArrayBuffer | Uint8Array): string;

  // Optional namespace members for completeness (not used by this project)
  export namespace sha256 {
    function update(message: string | ArrayBuffer | Uint8Array): { hex(): string };
    function hmac(
      key: string | ArrayBuffer | Uint8Array,
      message: string | ArrayBuffer | Uint8Array
    ): string;
  }

  const _default: typeof sha256;
  export default _default;
}