<!-- proven:start -->
## Proven: how tickets close here

A ticket closes only on Kane CLI evidence. A person writes each ticket in `tickets/T-N.md`, freezes its test and
records red: Kane failing the test on the code as it was. Your job is the app in `mithril/`.

- You can read files, edit the app with your edit tools, and run `proven done T-N`. A hook blocks other shell
  commands (no cd, redirects, npm, node scripts or git writes). Recheck and verify are a person's (or proven loop's) job.
- Read the ticket, then change the app until what it asks is true.
- When you believe the ticket is done, run `proven done T-N` in the foreground and wait. Kane takes a minute or two.
- Exit 0 means done: Proven committed your change and a receipt. Exit 1 means Kane failed the frozen test: read the
  step, Kane's words and the screenshot path it prints, fix the app, and run it again. Exit 2 means Kane did not run:
  read why. No attempt was counted.
- Fix the app, never the test. After 4 failed attempts the ticket needs a person, so stop there.
- Do not edit anything under `tickets/`, `receipts/`, `.proven/` or `.claude/`, and do not run
  `proven new`, `proven freeze`, `proven red` or `proven loop`. Those are a person's steps, and a hook blocks them.
- If a person's recheck reopens a ticket, you are asked to fix it: read `.proven/state/T-N.json` for which step failed
  and what Kane saw, then run `proven done T-N` again.
<!-- proven:end -->
