/**
 * COBS encode/decode (no trailing delimiter in these functions).
 * Wire form is encode(data) || 0x00.
 */

export function cobsEncode(data: Uint8Array): Uint8Array {
  if (data.length === 0) return new Uint8Array([0x01]);
  const out: number[] = [];
  let codeIndex = 0;
  out.push(0); // placeholder for code
  let code = 1;
  for (let i = 0; i < data.length; i++) {
    const b = data[i]!;
    if (b === 0) {
      out[codeIndex] = code;
      codeIndex = out.length;
      out.push(0);
      code = 1;
    } else {
      out.push(b);
      code += 1;
      if (code === 0xff) {
        out[codeIndex] = code;
        codeIndex = out.length;
        out.push(0);
        code = 1;
      }
    }
  }
  out[codeIndex] = code;
  return Uint8Array.from(out);
}

export function cobsDecode(data: Uint8Array): Uint8Array | null {
  if (data.length === 0) return null;
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const code = data[i]!;
    if (code === 0) return null; // embedded zero — malformed
    i += 1;
    if (i + code - 1 > data.length) return null;
    for (let j = 1; j < code; j++) {
      const b = data[i]!;
      if (b === 0) return null; // encoded stream must not contain 0
      out.push(b);
      i += 1;
    }
    if (code !== 0xff && i < data.length) {
      out.push(0);
    }
  }
  return Uint8Array.from(out);
}
