/**
 * Security utilities for redacting sensitive information from logs and snapshots
 */

/**
 * Redacts API keys and other secrets from strings for safe logging
 * @param str - The string to redact secrets from
 * @returns The string with secrets redacted
 */
export function redactSecrets(str: string): string {
  if (typeof str !== 'string') {
    if (str === null || str === undefined) {
      return '';
    }
    return String(str);
  }

  let redacted = str;

  // Common API key patterns
  const patterns = [
    // OpenAI: sk-...
    /sk-[a-zA-Z0-9]{32,}/g,
    // Anthropic: sk-ant-api03-...
    /sk-ant-api03-[a-zA-Z0-9_-]{32,}/g,
    // Google/Gemini: AIza...
    /AIza[a-zA-Z0-9_-]{32,}/g,
    // Generic long alphanumeric strings that could be API keys (20+ chars)
    /\b[a-zA-Z0-9]{20,}\b/g,
    // Bearer tokens
    /Bearer\s+[a-zA-Z0-9_-]{20,}/g,
    // Authorization headers
    /authorization:\s*[a-zA-Z0-9_-]{20,}/gi,
    // x-api-key headers
    /x-api-key:\s*[a-zA-Z0-9_-]{20,}/gi,
  ];

  // Apply each pattern
  for (const pattern of patterns) {
    redacted = redacted.replace(pattern, (match) => {
      // Keep first 4 and last 4 characters for identification, replace middle with exactly 4 asterisks
      if (match.length <= 8) {
        return '*'.repeat(match.length);
      }
      const prefix = match.substring(0, 4);
      const suffix = match.substring(match.length - 4);
      return `${prefix}****${suffix}`;
    });
  }

  return redacted;
}

/**
 * Redacts sensitive information from objects for safe logging
 * @param obj - The object to redact
 * @param sensitiveKeys - Array of keys that should be redacted
 * @returns The object with sensitive keys redacted
 */
export function redactObjectSecrets(
  obj: unknown,
  sensitiveKeys: string[] = ['apiKey', 'api_key', 'password', 'token', 'secret', 'key']
): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return redactSecrets(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redactObjectSecrets(item, sensitiveKeys));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (sensitiveKeys.some(sensitiveKey =>
        key.toLowerCase().includes(sensitiveKey.toLowerCase())
      )) {
        if (typeof value === 'string') {
          result[key] = redactSecrets(value);
        } else if (Array.isArray(value)) {
          // Process array elements individually for sensitive keys
          result[key] = value.map(item => redactObjectSecrets(item, sensitiveKeys));
        } else {
          result[key] = '[REDACTED]';
        }
      } else {
        result[key] = redactObjectSecrets(value, sensitiveKeys);
      }
    }

    return result;
  }

  return obj;
}