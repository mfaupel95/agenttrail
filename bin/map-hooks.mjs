// Match the actual Map relay, not product names in unrelated commands or metadata.
export const mapHookEvents = ['PreToolUse', 'PostToolUse', 'Stop', 'SessionStart', 'SubagentStop']
export const mapHookCommand = script => `node ${JSON.stringify(script)} hook`

export function hasMapHook(entries, command) {
  return Array.isArray(entries) && entries.some(entry =>
    entry?.matcher === '*' && Array.isArray(entry.hooks) && entry.hooks.some(hook =>
      hook?.type === 'command' && hook.command === command))
}

export function mapHooksInstalled(config, command) {
  return mapHookEvents.every(event => hasMapHook(config?.hooks?.[event], command))
}
