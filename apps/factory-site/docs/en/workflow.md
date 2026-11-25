---
title: Workflow v2
section: concepts
order: 4
---

## Nodes and ports

A workflow is a validated graph. An edge connects a named output port to a destination node. Trigger starts the graph; Agent delegates work; Condition selects a branch; Loop repeats within a bound; and Output collects results. An Approval can route `approved`, `rejected`, and `timeout` differently.

## Draft, publish, and run

Edit a draft and publish it to create a version. A run pins its definition and inputs. The engine persists node state, waits, and timers, so it can check outstanding work after a restart and resume without assuming interrupted attempts succeeded.

## Test with mock agents

Save a valid draft, choose **Test run**, enable **Mock agents**, and supply inputs. Mock agents do not consume model tokens. You can pin specific node data to test a path. Choose a flow without external writes for your first test; mock agents do not imply that every Action is disabled.
