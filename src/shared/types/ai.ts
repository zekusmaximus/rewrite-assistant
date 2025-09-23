/**
 * Shared AI status types used across renderer and services.
 * Source of truth for AIStatus shape.
 */

import type { ProviderName } from '../../services/ai/types';

export interface AIStatus {
  available: boolean;
  workingProviders: ProviderName[];
  needsConfiguration: boolean;
  lastChecked: number; // epoch ms
  isChecking: boolean;
}