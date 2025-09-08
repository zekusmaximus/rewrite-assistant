import { z } from 'zod';

export const IssueTypeEnum = z.enum(['pronoun_reference', 'timeline', 'character_knowledge', 'other']);

export const SeverityEnum = z.enum(['low', 'medium', 'high', 'critical']);

export const SpanSchema = z
  .object({
    start_index: z.number().int().nonnegative(),
    end_index: z.number().int().nonnegative(),
  })
  .refine((s) => s.end_index >= s.start_index, {
    message: 'end_index must be greater than or equal to start_index',
    path: ['end_index'],
  });

export const IssueSchema = z.object({
  type: IssueTypeEnum,
  severity: SeverityEnum,
  span: SpanSchema.optional().nullable().default(null),
  explanation: z.string().min(1, 'explanation must be non-empty'),
  evidence: z.array(z.string()).default([]),
  suggested_fix: z.string().default(''),
  confidence: z.number().min(0).max(1).optional(),
});

export const AnalysisResponseSchema = z.object({
  issues: z.array(IssueSchema).default([]),
  summary: z.string().default(''),
  confidence: z.number().min(0).max(1).optional(),
});

// Type exports
export type IssueType = z.infer<typeof IssueTypeEnum>;
export type Severity = z.infer<typeof SeverityEnum>;
export type Span = z.infer<typeof SpanSchema>;
export type Issue = z.infer<typeof IssueSchema>;
export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;