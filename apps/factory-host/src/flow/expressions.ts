import { evaluateParamCondition, flowPathSchema, type ConditionResult, type FlowCondition, type JsonSubset } from "@factory/contracts";

export function readPath(context: unknown, path: string): unknown {
  let value = context;
  for (const key of path.match(/[A-Za-z0-9_-]+/g) ?? []) {
    if (typeof value !== "object" || value === null || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export function render(template: string, context: unknown, missing: Set<string>): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, path: string) => {
    const value = flowPathSchema.safeParse(path).success ? readPath(context, path) : undefined;
    if (value === undefined) { missing.add(path); return ""; }
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

export function evaluate(condition: FlowCondition, context: { inputs: Record<string, unknown> }): ConditionResult {
  if ("not" in condition) {
    const result = evaluate(condition.not, context);
    return result === "unknown" ? result : result === "true" ? "false" : "true";
  }
  if ("all" in condition || "any" in condition) {
    const all = "all" in condition;
    const results = (all ? condition.all : condition.any).map((child) => evaluate(child, context));
    if (results.includes(all ? "false" : "true")) return all ? "false" : "true";
    return results.includes("unknown") ? "unknown" : all ? "true" : "false";
  }
  if ("path" in condition) return evaluateParamCondition({ param: "value", op: condition.op, value: condition.value },
    { value: readPath(context, condition.path) });
  return evaluateParamCondition(condition, context.inputs);
}

export function matchesSchema(value: unknown, schema: JsonSubset): boolean {
  switch (schema.type) {
    case "object": return typeof value === "object" && value !== null && !Array.isArray(value)
      && (schema.required ?? []).every((key) => Object.hasOwn(value, key))
      && Object.entries(schema.properties).every(([key, child]) => !Object.hasOwn(value, key) || matchesSchema((value as Record<string, unknown>)[key], child));
    case "array": return Array.isArray(value) && value.length <= (schema.maxItems ?? Infinity) && value.every((item) => matchesSchema(item, schema.items));
    case "string": return typeof value === "string" && value.length <= (schema.maxLength ?? Infinity) && (!schema.enum || schema.enum.includes(value));
    case "integer": return Number.isInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
  }
}
