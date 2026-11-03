/**
 * A response's body as text, or null once it passes `maxBytes`. Read as it arrives, so a server that sends far more than
 * an answer should be is cut off there instead of filling memory first.
 */
export async function readCappedText(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  if (response.body === null) return '';

  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    size += part.value.length;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    parts.push(part.value);
  }
  return Buffer.concat(parts).toString('utf8');
}
