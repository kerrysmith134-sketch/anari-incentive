# ADR-004: AI evaluation gate before scoring suggestions

- **Status**: Accepted
- **Date**: 2026-10-27
- **Context**: V4.0 placed the Evaluation Agent in P0 but model/evaluation-quality testing in P1. That inverts the risk order: it lets AI scoring suggestions into the pilot before there is evidence that they are reliable, unbiased, and safe against prompt injection.
- **Decision**:
  - Evaluation quality is a P0 capability. The gate includes: gold set (100–300 cases per role/order type), 2+ independent human raters, Cohen's/Fleiss' kappa or ICC, subgroup analysis, counterfactual tests, adversarial prompt-injection tests, and model/prompt drift regression.
  - Until the gate passes, the agent may only retrieve/summarize evidence, detect gaps, and draft questions. It must not produce a numeric score recommendation.
  - Human review must capture independent judgment before showing AI output; review time, evidence opened, override rate/reason and blind-audit samples are recorded.
  - The agent is optional: `AI disabled` is a supported operating mode.
  - Evidence documents are untrusted input. Content is separated from instructions; retrieved text cannot trigger tool calls; tool use is least-privilege and output is schema-validated.
- **Consequences**:
  - The first slice contains no AI scoring.
  - The evaluation harness becomes a prerequisite for the first AI-assisted evaluation, not a post-launch nice-to-have.
  - Model/prompt upgrades require a regression run and a rollback path.
