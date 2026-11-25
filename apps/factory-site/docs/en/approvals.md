---
title: Approvals & policies
section: concepts
order: 6
---

## Set boundaries

Tool policies use `allow`, `ask`, or `deny` per agent. Budgets, autonomy levels, and circuit breakers constrain execution. An approval can gate a task, a workflow path, or an external action and records who made the decision.

## Review the evidence

In **Needs attention**, inspect the scope and evidence before you approve or reject. An approval node can also route on timeout.

> Reconcile an unknown external effect against the destination before retrying. A lost connection does not prove an external write failed.
