import { describe, it, expect } from 'vitest';
import { redactSecrets, redactObjectSecrets } from './security';

describe('redactSecrets', () => {
  it('should redact OpenAI API keys', () => {
    const apiKey = 'sk-1234567890abcdef1234567890abcdef1234567890';
    const result = redactSecrets(apiKey);
    expect(result).toBe('sk-1****7890');
  });

  it('should redact Anthropic API keys', () => {
    const apiKey = 'sk-ant-api03-1234567890abcdef1234567890abcdef';
    const result = redactSecrets(apiKey);
    expect(result).toBe('sk-a****cdef');
  });

  it('should redact Google API keys', () => {
    const apiKey = 'AIzaSy1234567890abcdef1234567890abcdef12345678';
    const result = redactSecrets(apiKey);
    expect(result).toBe('AIza****5678');
  });

  it('should not redact non-API key strings', () => {
    const normalString = 'This is just a normal string without any secrets';
    const result = redactSecrets(normalString);
    expect(result).toBe(normalString);
  });

  it('should handle empty strings', () => {
    const result = redactSecrets('');
    expect(result).toBe('');
  });

  it('should handle null/undefined', () => {
    const result1 = redactSecrets(null as any);
    const result2 = redactSecrets(undefined as any);
    expect(result1).toBe('');
    expect(result2).toBe('');
  });
});

describe('redactObjectSecrets', () => {
  it('should redact API keys in objects', () => {
    const obj = {
      apiKey: 'sk-1234567890abcdef1234567890abcdef1234567890',
      otherField: 'normal value',
      nested: {
        secret: 'sk-ant-api03-1234567890abcdef1234567890abcdef',
        normal: 'another normal value'
      }
    };

    const result = redactObjectSecrets(obj) as any;
    expect(result.apiKey).toBe('sk-1****7890');
    expect(result.otherField).toBe('normal value');
    expect(result.nested.secret).toBe('sk-a****cdef');
    expect(result.nested.normal).toBe('another normal value');
  });

  it('should handle arrays with secrets', () => {
    const obj = {
      keys: [
        'sk-1234567890abcdef1234567890abcdef1234567890',
        'sk-ant-api03-1234567890abcdef1234567890abcdef'
      ]
    };

    const result = redactObjectSecrets(obj) as any;
    expect(result.keys[0]).toBe('sk-1****7890');
    expect(result.keys[1]).toBe('sk-a****cdef');
  });

  it('should handle non-objects gracefully', () => {
    const result1 = redactObjectSecrets('string');
    const result2 = redactObjectSecrets(123);
    const result3 = redactObjectSecrets(null);
    const result4 = redactObjectSecrets(undefined);

    expect(result1).toBe('string');
    expect(result2).toBe(123);
    expect(result3).toBe(null);
    expect(result4).toBe(undefined);
  });
});