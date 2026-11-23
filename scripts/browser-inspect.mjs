// Common read-only DOM metadata capability. The testing agent supplies only a
// current MCP element reference, never JavaScript, selectors or attribute names.
export const inspectTool = {
  name: 'browser_inspect',
  description: 'Read bounded public locator attributes of an element from its current snapshot reference and up to three ancestors. Visibility follows layout dimensions and CSS display/visibility; opacity and occlusion are not judged. Returns allowlisted DOM attributes, without input values, child text, scripts, private JavaScript state or test verdicts.',
  inputSchema: { type: 'object', properties: { target: { type: 'string', pattern: '^e[0-9]+$' } }, required: ['target'], additionalProperties: false },
};

// Self-contained because the proxy sends this fixed function to native MCP.
// Keep the response validator's list synchronized with this literal allowlist.
// Attribute contents are public fixture metadata, including on ancestors. This
// does not semantically redact arbitrary secrets encoded in public attributes.
// Private instrumentation must never write its state into these attributes.
export function inspectVisibleElement(element) {
  const allowed = ['id', 'class', 'role', 'name', 'type', 'placeholder', 'title', 'aria-label', 'aria-labelledby', 'aria-describedby', 'data-test', 'data-testid', 'data-cy'];
  const visible = node => {
    const box = node.getBoundingClientRect(), style = getComputedStyle(node);
    return box.width > 0 && box.height > 0 && !['hidden', 'collapse'].includes(style.visibility) && style.display !== 'none';
  };
  if (!element || element.nodeType !== 1 || !visible(element)) throw new Error('A currently visible element is required');
  const describe = node => ({ tag: node.tagName.toLowerCase(), attributes: Object.fromEntries(allowed.flatMap(key => {
    const value = node.getAttribute(key);
    return value === null ? [] : [[key, value.slice(0, 256)]];
  })) });
  const ancestors = [];
  for (let node = element.parentElement; node && ancestors.length < 3; node = node.parentElement) {
    if (!visible(node)) break;
    ancestors.push(describe(node));
  }
  return { schema: 'visible-dom-attributes-v1', element: describe(element), ancestors };
}

const attributeNames = new Set(['id', 'class', 'role', 'name', 'type', 'placeholder', 'title', 'aria-label', 'aria-labelledby', 'aria-describedby', 'data-test', 'data-testid', 'data-cy']);
export function inspectionArguments(target) {
  return { target, function: inspectVisibleElement.toString() };
}
export function inspectionToolResult(native) {
  const failed = () => ({ isError: true, content: [{ type: 'text', text: 'DOM inspection failed. Use a current snapshot reference to a visible element.' }] });
  if (native?.isError) return failed();
  try {
    const results = (native?.content || []).filter(block => block.type === 'text').flatMap(block => {
      const marker = block.text.indexOf('### Result\n');
      if (marker < 0) return [];
      return [JSON.parse(block.text.slice(marker + 11).split('\n### ')[0].trim())];
    });
    if (results.length !== 1) return failed();
    const value = results[0];
    if (value.schema !== 'visible-dom-attributes-v1' || !Array.isArray(value.ancestors) || value.ancestors.length > 3) return failed();
    const project = item => {
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(item?.tag) || !item.attributes || typeof item.attributes !== 'object' || Array.isArray(item.attributes)) throw new Error('Invalid element');
      const attributes = Object.fromEntries(Object.entries(item.attributes).filter(([key]) => attributeNames.has(key)).map(([key, text]) => {
        if (typeof text !== 'string' || text.length > 256) throw new Error('Invalid attribute');
        return [key, text];
      }));
      return { tag: item.tag, attributes };
    };
    const result = { schema: value.schema, element: project(value.element), ancestors: value.ancestors.map(project) };
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch { return failed(); }
}
