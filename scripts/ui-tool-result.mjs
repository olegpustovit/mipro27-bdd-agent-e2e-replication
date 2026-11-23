// Native MCP adds console counts/log links and HTTP metadata even when console
// and network tools are disabled. Keep these in the private raw audit only.
// Parse top-level sections outside code fences so actual UI text is preserved.
export function uiToolResult(result) {
  if (!result) return undefined;
  if (!Array.isArray(result.content)) return { isError: true,
    content: [{ type: 'text', text: 'Browser tool returned no supported UI observation.' }] };
  return { ...(typeof result.isError === 'boolean' ? { isError: result.isError } : {}), content: result.content.filter(block => ['text', 'image'].includes(block.type)).map(block => {
    if (block.type === 'image') return { type: 'image', data: block.data, mimeType: block.mimeType };
    let section = '', fence = null;
    const kept = [];
    for (const line of block.text.split('\n')) {
      const boundary = line.match(/^(`{3,}|~{3,})/);
      if (boundary) {
        if (!fence) fence = boundary[1];
        else if (boundary[1][0] === fence[0] && boundary[1].length >= fence.length) fence = null;
        kept.push(line); continue;
      }
      if (!fence && /^### /.test(line)) { section = line.slice(4); kept.push(line); continue; }
      if (!fence && section === 'Page' && /^- (?:Console:|HTTP status:)/.test(line)) continue;
      if (!fence && section === 'Events' && /^- New console entries:/.test(line)) continue;
      kept.push(line);
    }
    // Empty diagnostics section should not add an unexplained heading.
    const text = kept.join('\n').replace(/^### Events\n(?=### |$)/gm, '');
    return { type: 'text', text };
  }) };
}

export function uiToolError(error) {
  return error ? { code: Number.isInteger(error.code) ? error.code : -32000,
    message: 'Browser UI tool request failed.' } : undefined;
}
