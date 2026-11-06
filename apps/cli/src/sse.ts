export type ServerSentEvent = { event: string; data: string };

function parseEvent(block: string): ServerSentEvent | undefined {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:"))
      data.push(line.slice(5).replace(/^ /, ""));
  }
  return data.length ? { event, data: data.join("\n") } : undefined;
}

export async function* parseServerSentEvents(
  chunks: AsyncIterable<string>,
): AsyncGenerator<ServerSentEvent> {
  let buffer = "";
  for await (const chunk of chunks) {
    buffer += chunk;
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = parseEvent(block);
      if (event) yield event;
    }
  }
  const last = parseEvent(buffer);
  if (last) yield last;
}
