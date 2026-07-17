# Jira Workflow

How work flows across the board and who owns each transition. Every branch, commit, and PR
references a Jira key (e.g. `JMS-1234`).

---

## Board columns

```
Backlog → Ready → In Progress → Code Review → Testing → Done
                          ↘──────── Blocked ────────↗
```

| Column | Meaning | Who moves it here |
|--------|---------|-------------------|
| **Backlog** | Captured but not yet prioritized/refined. | PM |
| **Ready** | Refined, estimated, has acceptance criteria — ready to pick up. | PM / Senior |
| **In Progress** | Actively being developed on a `feature/*`/`bugfix/*` branch. | Developer (on start) |
| **Code Review** | PR open, awaiting review/approval. | Developer (on PR open) |
| **Testing** | Merged to `develop`, deployed to staging, awaiting QA verification. | Developer / CI |
| **Done** | Verified on staging (or shipped) and accepted. | QA / PM |
| **Blocked** | Cannot proceed (dependency, question, environment). Note the blocker. | Anyone (with a reason) |

A ticket in **Blocked** must have a comment stating *what* it's blocked on and *who* can unblock it.

---

## Responsibilities by role

### Junior Developer
- Pick tickets from **Ready** (not Backlog); confirm you understand the acceptance criteria first.
- Move to **In Progress**, create a branch named with the Jira key.
- Ask early when blocked — move to **Blocked** with a clear note rather than going silent.
- Write tests; self-review against [CODE_REVIEW_GUIDELINES.md](CODE_REVIEW_GUIDELINES.md) before requesting review.
- Open PR → move to **Code Review**. Address all review feedback.

### Senior Developer
- Refine Backlog into **Ready** (clear scope, acceptance criteria, estimate).
- Review PRs promptly and thoroughly; approve only when confident.
- Mentor juniors; unblock **Blocked** tickets.
- Own risky changes (startup, DB restore, sync, deploy) and their rollback plans.
- Approve production releases and hotfixes.

### QA
- Owns the **Testing** column. Verify on **staging** against acceptance criteria + regression.
- Reproduce and triage bug reports; label severity.
- Move to **Done** only when verified; kick back to **In Progress** with clear repro if it fails.
- Do not push code (Triage role) — verify and report.

### Project Manager
- Owns **Backlog** and prioritization; keeps **Ready** stocked.
- Runs standups; watches **Blocked** and drives resolution.
- Coordinates releases and stakeholder communication.
- Confirms **Done** meets the business need.

---

## Conventions

- **Branch**: `feature/JMS-1234-short-desc` (or team style with the key present).
- **Commit**: reference the key in the body — `Refs: JMS-1234` (see [COMMIT_CONVENTION.md](COMMIT_CONVENTION.md)).
- **PR**: put the Jira key in the title/description; link the ticket.
- Smart commits (`JMS-1234 #comment ...`) may transition tickets automatically if enabled.
