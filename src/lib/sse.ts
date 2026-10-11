/** Server-Sent Events (Streaming-Antworten der KI-Schnittstellen). */

/** Zerlegt einen Server-Sent-Events-Strom in die einzelnen `data:`-Inhalte. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const take = function* (final: boolean) {
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = final ? '' : (blocks.pop() ?? '');
    for (const block of blocks) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data.trim()) yield data;
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    yield* take(false);
  }
  buffer += decoder.decode();
  yield* take(true);
}
