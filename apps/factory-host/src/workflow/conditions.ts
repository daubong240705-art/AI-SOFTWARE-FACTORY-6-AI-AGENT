import type { Condition, ConditionResult, WorkflowValue } from "@factory/contracts";
import { evaluateParamCondition } from "@factory/contracts";

export function evaluateWorkflowCondition(condition: Condition, params: Readonly<Record<string, unknown>>,
  resolve: (fact: Extract<Condition, { fact: string }>) => WorkflowValue | undefined): ConditionResult {
  if ("not" in condition) {
    const value = evaluateWorkflowCondition(condition.not, params, resolve);
    return value === "unknown" ? value : value === "true" ? "false" : "true";
  }
  if ("all" in condition || "any" in condition) {
    const all = "all" in condition;
    const values = (all ? condition.all : condition.any).map((child) => evaluateWorkflowCondition(child, params, resolve));
    return all ? values.includes("false") ? "false" : values.includes("unknown") ? "unknown" : "true"
      : values.includes("true") ? "true" : values.includes("unknown") ? "unknown" : "false";
  }
  if ("param" in condition) return evaluateParamCondition(condition, params);
  const value = resolve(condition);
  return value === undefined ? "unknown" : evaluateParamCondition({ param: "value", op: condition.op, value: condition.value }, { value });
}
