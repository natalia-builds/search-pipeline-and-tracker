---
name: Decision
about: A choice to make and write down before any build work that depends on it
title: "Decide "
labels: decision
assignees: ""
---

## Why

<!-- The question, in plain language, and why it has to be decided before building. -->

## What to do

Compare at least these options and record the choice:

1. <!-- Option A, with the tradeoffs -->
2. <!-- Option B, with the tradeoffs -->
3. <!-- "Do nothing" or "not now", when that is a real outcome -->

Write the result as `docs/decisions/<topic>.md` with the comparison, the decision, its consequences and the date. If the decision is to build, create the build issues, each saying it assumes this decision.

## Done when

<!-- Real checkboxes. Tick a box only when it was actually checked; leave it unticked and say why in a comment if it was not. -->

- [ ] `docs/decisions/<topic>.md` exists with the options, the decision, its consequences and the date.
- [ ] <!-- Any fact the decision relies on that needs checking, with what was and was not checked recorded -->
- [ ] If the decision is to build: the build issues exist, each referring to the record. If not: the README Roadmap says it is not planned.
- [ ] No code changes in this issue.

---
**Before you start:** read `CLAUDE.md`. Work on a new branch and open a pull request with one purpose. This issue is sized for one short session. If it grows past that, stop and split it, and say so on the issue.
