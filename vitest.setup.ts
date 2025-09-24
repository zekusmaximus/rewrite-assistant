import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend Vitest's expect with jest-dom matchers globally
expect.extend(matchers);

// Provide mock API keys for tests that need them
process.env.ANTHROPIC_API_KEY = 'test-claude-key-for-testing';
process.env.OPENAI_API_KEY = 'test-openai-key-for-testing';
process.env.GEMINI_API_KEY = 'test-gemini-key-for-testing';