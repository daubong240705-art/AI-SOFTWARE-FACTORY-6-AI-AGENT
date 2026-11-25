---
name: workflow-verdict
description: Return structured fact-check decisions that let the research workflow route corrections.
version: 1.0.0
source: Original Factory pack guidance.
---

# Evidence review verdicts

For the report fact-check, call `task.result` with `{"result":{"verdict":"pass","notes":"..."}}` or use `fail`. Do not put the verdict only in a final message. Pass when material claims have traceable support and the report represents limitations and counterevidence accurately. Fail for unsupported claims, broken attribution, or material evidence gaps the report does not acknowledge. Keep notes in the operator's language, within 2,400 characters; give claim and source locators and the smallest correction needed.

For an automatic peer review of the evidence ledger, return `accepted` or `changes-requested` under `result.verdict` instead. Neither form substitutes for operator approval.
