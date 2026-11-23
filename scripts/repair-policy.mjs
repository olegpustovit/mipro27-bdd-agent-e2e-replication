import { parse } from 'acorn';
import { validateCall } from './browser-policy.mjs';
const exportsRequired = ['signIn', 'signOut', 'updateProfile', 'invalidEmail', 'addBank', 'deleteBank', 'transfer', 'openPersonalFeed', 'like', 'comment', 'selectFeed'];
const methods = new Set(['act', 'page', 'locator', 'goto', 'click', 'fill', 'press', 'filter', 'getByRole', 'getByLabel', 'getByPlaceholder', 'getByText', 'first', 'last', 'nth', 'count', 'isVisible', 'isEnabled', 'textContent', 'waitFor', 'waitForURL']);
const mutations = new Set(['goto', 'click', 'fill', 'press']);
const forbidden = new Set(['process', 'global', 'globalThis', 'window', 'document', 'fetch', 'require', 'eval', 'Function', 'WebSocket', 'XMLHttpRequest', 'Buffer', 'console', 'Deno', 'Bun', 'Promise', 'Reflect', 'Proxy']);
// Constrains repair to browser interactions. Node filesystem permissions are a
// second layer; this policy is not presented as an adversarial JS sandbox.
export function validateActions(source) {
  if (typeof source !== 'string' || source.length > 24000) throw new Error('Action source limit exceeded');
  const tree = parse(source, { ecmaVersion: 2024, sourceType: 'module' });
  const names = [];
  for (const node of tree.body) {
    if (node.type !== 'ExportNamedDeclaration' || node.declaration?.type !== 'FunctionDeclaration' || !node.declaration.async) throw new Error('Only exported async UI action functions are allowed');
    names.push(node.declaration.id.name);
  }
  if (JSON.stringify(names.sort()) !== JSON.stringify([...exportsRequired].sort())) throw new Error('Action exports are immutable');
  const deniedNodes = new Set(['ImportDeclaration', 'ImportExpression', 'NewExpression', 'ThisExpression', 'ClassDeclaration', 'ClassExpression', 'WithStatement', 'DebuggerStatement', 'ThrowStatement', 'TryStatement', 'AssignmentExpression', 'UpdateExpression', 'WhileStatement', 'DoWhileStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'YieldExpression', 'TaggedTemplateExpression', 'SpreadElement', 'RestElement']);
  function visit(node, context, parent) {
    if (!node || typeof node !== 'object') return;
    if (deniedNodes.has(node.type)) throw new Error(`Non-UI repair construct rejected: ${node.type}`);
    if (node.type === 'Identifier' && (forbidden.has(node.name) || /^(?:__proto__|prototype|constructor)$/.test(node.name))) throw new Error(`Non-UI identifier rejected: ${node.name}`);
    if (node.type === 'MemberExpression' && (node.computed || !methods.has(node.property.name))) throw new Error(`Non-UI member rejected: ${node.property?.name || 'computed property'}`);
    if (node.type === 'CallExpression' && node.callee.type !== 'MemberExpression') throw new Error('Action delegation and indirect calls are not allowed; use sequential awaited World.act calls');
    if (node.type === 'FunctionDeclaration' && node !== context.rootFunction) throw new Error('Nested repair functions are not allowed');
    if (['ArrowFunctionExpression', 'FunctionExpression'].includes(node.type) && node !== context.act?.callback) throw new Error('Inline callbacks are reserved for the observation wrapper');
    if (node.type === 'VariableDeclarator') {
      const bindsWorld = value => value && typeof value === 'object' &&
        (value.type === 'Identifier' ? value.name === context.world : Object.values(value).some(v => Array.isArray(v) ? v.some(bindsWorld) : bindsWorld(v)));
      if (bindsWorld(node.id)) throw new Error('The World parameter cannot be shadowed');
    }
    if (node.type === 'MemberExpression' && (mutations.has(node.property.name) || node.property.name === 'act') &&
      !(parent?.type === 'CallExpression' && parent.callee === node)) throw new Error('UI mutation methods cannot be aliased');
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.property.name === 'act') {
      if (context.act || node.callee.object.type !== 'Identifier' || node.callee.object.name !== context.world || parent?.type !== 'AwaitExpression') throw new Error('Every UI action must await the actual World observation wrapper');
      const callback = node.arguments[0];
      if (node.arguments.length !== 1 || !['ArrowFunctionExpression', 'FunctionExpression'].includes(callback?.type) || callback.params.length) throw new Error('World.act requires one inline zero-argument callback');
      let result = callback.body;
      if (result.type === 'BlockStatement') result = result.body.length === 1 && result.body[0].type === 'ReturnStatement' ? result.body[0].argument : null;
      if (result?.type === 'AwaitExpression') result = result.argument;
      if (result?.type !== 'CallExpression' || result.callee.type !== 'MemberExpression' || !mutations.has(result.callee.property.name)) throw new Error('World.act must return exactly one UI mutation promise');
      const act = { callback, mutations: 0 };
      visit(node.callee, context, node);
      visit(callback, { ...context, act }, node);
      if (act.mutations !== 1) throw new Error('World.act must contain exactly one UI mutation');
      return;
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && mutations.has(node.callee.property.name)) {
      if (!context.act) throw new Error('UI mutations must use the World observation wrapper');
      context.act.mutations++;
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.property.name === 'goto') {
      const url = node.arguments[0];
      if (url?.type !== 'Literal' || typeof url.value !== 'string' || !/^http:\/\/localhost:3000\/(signin)?$/.test(url.value) || validateCall('browser_navigate', { url: url.value })) throw new Error('Navigation repairs must use a literal ordinary application UI URL');
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.property.name === 'locator' && node.callee.object.type === 'MemberExpression' && node.callee.object.property.name === 'page') throw new Error('Use the shared locator registry for CSS selectors; direct page access is semantic UI selectors only');
    if (node.type === 'Literal' && typeof node.value === 'string' && /(?:https?:\/\/|\/testData|__oracle|__study)/i.test(node.value) && !/^http:\/\/localhost:3000\/(?:signin|bankaccounts|user\/settings|transaction\/[\w-]+|personal|contacts)?$/.test(node.value)) throw new Error('Only ordinary application page navigation is allowed');
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(child => visit(child, context, node)); else if (value && typeof value === 'object') visit(value, context, node);
  }
  for (const exported of tree.body) {
    const fn = exported.declaration;
    if (fn.params[0]?.type !== 'Identifier') throw new Error('An action requires an explicit World parameter');
    visit(fn, { world: fn.params[0].name, rootFunction: fn }, exported);
  }
  return source;
}
