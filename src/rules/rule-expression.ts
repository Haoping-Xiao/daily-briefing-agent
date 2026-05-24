import type { RuleExpression, RulePredicate } from "../domain/types.js";

export type RuleContext = Record<string, unknown>;

export function evaluateRuleExpression(expression: RuleExpression, context: RuleContext): boolean {
  if ("all" in expression) return expression.all.every((child) => evaluateRuleExpression(child, context));
  if ("any" in expression) return expression.any.some((child) => evaluateRuleExpression(child, context));
  if ("not" in expression) return !evaluateRuleExpression(expression.not, context);
  return evaluatePredicate(expression, context);
}

function evaluatePredicate(predicate: RulePredicate, context: RuleContext): boolean {
  const fieldValue = context[predicate.field];
  switch (predicate.op) {
    case "contains":
      return String(fieldValue ?? "").toLowerCase().includes(predicate.value.toLowerCase());
    case "equals":
      return fieldValue === predicate.value;
    case "in":
      return predicate.values.includes(String(fieldValue ?? ""));
    case "intersects":
      return intersects(fieldValue, predicate.values);
  }
}

function intersects(fieldValue: unknown, values: string[]): boolean {
  const normalizedValues = values.map((value) => value.toLowerCase());
  if (Array.isArray(fieldValue)) {
    return fieldValue.some((value) => normalizedValues.includes(String(value).toLowerCase()));
  }
  const text = String(fieldValue ?? "").toLowerCase();
  return normalizedValues.some((value) => text.includes(value));
}
