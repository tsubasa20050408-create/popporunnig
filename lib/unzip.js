// 依存なしのZIP展開 + gzip展開。ブラウザ標準のDecompressionStreamを使用。
// Strava一括エクスポートZIPを丸ごと取り込めるようにするためのもの。

async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(bytes) {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipText(bytes) {
  return new TextDecoder().decode(await gunzip(bytes));
}

// ArrayBuffer(ZIP) → [{ name, bytes:Uint8Array }]
// 中央ディレクトリから各エントリを読み、method 0(無圧縮)/8(deflate)に対応。
export async function unzip(arrayBuffer) {
  const buf = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  // End Of Central Directory (0x06054b50) を末尾から探す
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not_a_zip");
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true); // 中央ディレクトリ開始位置

  const out = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break; // central dir header
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(buf.subarray(off + 46, off + 46 + nameLen));

    // ローカルヘッダから実データ位置を計算
    if (dv.getUint32(localOff, true) === 0x04034b50) {
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const comp = buf.subarray(dataStart, dataStart + compSize);
      let bytes;
      if (method === 0) bytes = comp;
      else if (method === 8) bytes = await inflateRaw(comp);
      else { off += 46 + nameLen + extraLen + commentLen; continue; } // 未対応圧縮
      if (!name.endsWith("/")) out.push({ name, bytes });
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
