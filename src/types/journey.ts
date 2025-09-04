import { z } from 'zod';

// Operators supported by condition nodes
export const OperatorEnum = z.enum(['==', '!=', '>', '>=', '<', '<=']);
export type Operator = z.infer<typeof OperatorEnum>;

// A very small patient context shape: keys map to primitive values.
export const PatientContextSchema = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]));
export type PatientContext = z.infer<typeof PatientContextSchema>;

// Node types
export const NodeTypeEnum = z.enum(['MESSAGE', 'DELAY', 'CONDITION']);
export type NodeType = z.infer<typeof NodeTypeEnum>;

// MESSAGE node: simple message to be delivered (stubbed by console.log by the executor)
export const MessageNodeSchema = z.object({
  id: z.string(),
  type: z.literal('MESSAGE'),
  name: z.string().optional(),
  // free-form message template
  message: z.string(),
  // optional pointer to the next node id
  next: z.string().nullable().optional(),
});
export type MessageNode = z.infer<typeof MessageNodeSchema>;

// DELAY node: wait for a number of seconds before continuing (executor persists next_wake_at)
export const DelayNodeSchema = z.object({
  id: z.string(),
  type: z.literal('DELAY'),
  name: z.string().optional(),
  // seconds to wait (alternative to an absolute timestamp)
  delaySeconds: z.number().int().nonnegative(),
  next: z.string().nullable().optional(),
});
export type DelayNode = z.infer<typeof DelayNodeSchema>;

// CONDITION node: evaluates a comparison against the patient context and branches
export const ConditionExpressionSchema = z.object({
  // a simple dot-free key into PatientContext (for now)
  leftKey: z.string(),
  operator: OperatorEnum,
  // right can be a primitive literal
  rightValue: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});
export type ConditionExpression = z.infer<typeof ConditionExpressionSchema>;

export const ConditionNodeSchema = z.object({
  id: z.string(),
  type: z.literal('CONDITION'),
  name: z.string().optional(),
  condition: ConditionExpressionSchema,
  // where to go next based on condition result
  trueNext: z.string().nullable().optional(),
  falseNext: z.string().nullable().optional(),
});
export type ConditionNode = z.infer<typeof ConditionNodeSchema>;

// Discriminated union of nodes
export const NodeSchema = z.discriminatedUnion('type', [
  MessageNodeSchema,
  DelayNodeSchema,
  ConditionNodeSchema,
]);
export type Node = z.infer<typeof NodeSchema>;

// Journey schema: a collection of nodes with an optional starting node id
export const JourneySchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  // nodes must have unique ids (not enforced here, executor/repo should validate)
  nodes: z.array(NodeSchema),
  // optional explicit start node id; if absent executor should use the first node in the array
  startNodeId: z.string().optional(),
  // optional metadata
  metadata: z.record(z.any()).optional(),
});
export type Journey = z.infer<typeof JourneySchema>;

// A small contract helper: validate a journey and return typed object
export function parseJourney(input: unknown): Journey {
  return JourneySchema.parse(input);
}

export default {
  OperatorEnum,
  PatientContextSchema,
  NodeTypeEnum,
  MessageNodeSchema,
  DelayNodeSchema,
  ConditionNodeSchema,
  NodeSchema,
  JourneySchema,
};
