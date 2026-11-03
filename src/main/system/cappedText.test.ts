import { describe, expect, it } from 'vitest';
import { readCappedText } from '@main/system/cappedText';

function streamed(chunks: string[], headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { headers });
}

describe('readCappedText', () => {
  it('reads a body that fits', async () => {
    expect(await readCappedText(streamed(['{"a":', '1}']), 100)).toBe('{"a":1}');
  });

  it('stops at the cap however the body arrives', async () => {
    expect(await readCappedText(streamed(['x'.repeat(60), 'x'.repeat(60)]), 100)).toBeNull();
  });

  it("refuses up front when the server says it's too big", async () => {
    expect(await readCappedText(streamed(['small'], { 'content-length': '5000' }), 100)).toBeNull();
  });
});
