# Proven on TodoMVC Mithril: deleting one todo deleted another

This repo is a recorded run of [Proven](https://github.com/vijaygopalbalasa/proven) on an app I didn't write, against a
bug I didn't plant.

The app is the TodoMVC Mithril example (tastejs/todomvc at `ff43b02`), copied into `mithril/` unchanged in `c6fbeeb`.
The bug is [tastejs/todomvc#2312](https://github.com/tastejs/todomvc/issues/2312), opened by another GitHub user on
Nov 6 2026 and still open when I ran this on Nov 14: add `done-one`, `keep-a` and `keep-b`, tick `done-one`, open the
Active view, delete `keep-a`, then go back to All. `keep-a` is still there, and `done-one`, which was hidden, is gone.

You can see it in 30 seconds on the live example at https://todomvc.com/examples/mithril/ .

The fix is open as a pull request on TodoMVC: https://github.com/tastejs/todomvc/pull/2318

## What happened

- I wrote ticket T-1 from the issue's steps and expected result. It names no cause and no file. After adding the three
  todos, each step is one click and a check, and the last check names the two todos that must remain.
- Kane failed it on the app as it was (red at `f68d6d0`, recorded in `e1bbe37`): "The final check expected two todos,
  but the page contained only keep-b after the All filter was selected." `done-one`, which nobody clicked, was gone.
- `proven loop` gave T-1 to Claude Code (Sonnet 5.5) running headless. Its final message said: "`remove` and
  `doneEditing` took the todo's position in the filtered list but spliced that position out of the full list. In the
  Active view keep-a sits at index 0, so deleting it removed done-one, which is index 0 in the full list." It changed
  both to use the todo itself (`mithril/js/controllers/todo.js`, `mithril/js/views/main-view.js`). Kane passed the
  same frozen test on the first attempt (green `b2f8997`, receipt `9579cd6`), and the loop's fresh recheck passed it
  again.

Kane credits: red 100.41, green 67.37, recheck 76.74.

## Why Kane's red ends with only keep-b

In its delete step Kane used `keep-a`'s delete button twice: it clicked it, then pressed a key on the same focused
button. On the app as it was, the click deleted `done-one` instead of `keep-a`, so `keep-a` and its button were still
there for the key press, which deleted `keep-a`, and All ended with only `keep-b`. On the fixed app the click deleted
`keep-a`, the button went with it, and the key press did nothing, so All showed `done-one` and `keep-b`.
`check/kane-actions-2312.cjs` does the same click and key press and gets Kane's end state at both commits. With one
click, as in the issue, `check/check-2312.cjs` ends with `keep-a` and `keep-b` on the app as it was, and with
`done-one` and `keep-b` after the change.

## A second path the agent fixed

The issue doesn't mention it, but editing had the same mistake. On the app as it was, emptying `keep-a`'s text in the
Active view deleted `done-one` and left `keep-a` as a blank todo. After the change it deletes `keep-a`.
`check/edit-empty-2312.cjs` shows both.

## Check it

```
git clone https://github.com/vijaygopalbalasa/proven-todomvc-2312 && cd proven-todomvc-2312
npx github:vijaygopalbalasa/proven#d881f89 verify receipts/T-1.json            # git only, no login
npx github:vijaygopalbalasa/proven#d881f89 verify receipts/T-1.json --replay   # Kane at red and at green
```

`--replay` needs Kane CLI and a TestMu login. It runs Kane twice, about 7 to 10 minutes in all, for about 130 to 140
credits. The lock pinned a limit of 300 s per Kane run at freeze, and replay runs get twice that.

I replayed this receipt five times on Nov 14, each from a fresh clone. The first four ran on an earlier Proven that
cut each replay run off at 300 s. Two of those went all the way: Kane failed step 6 at red and passed all
six steps at green. In the other two, Kane failed step 6 at red but didn't finish within 300 s, so green never ran,
and that build still printed CONFIRMED from the git checks alone. The fifth ran on the commit pinned above, which
gives replay runs 600 s, and went all the way in 442 s. Kane's words at red that time: "Selecting All leaves out the
completed todo done-one." For a replay cut off like those two, the pinned commit prints `CONFIRMED (git checks only)`
and exits with code 2.

The checks without Kane need Node, Playwright and Google Chrome:

```
npm i --no-save playwright
git worktree add ../before c6fbeeb && git worktree add ../after b2f8997
python3 -m http.server -d ../before/mithril 8001 &
python3 -m http.server -d ../after/mithril 8002 &
node check/check-2312.cjs http://127.0.0.1:8001/   # FAIL: keep-a and keep-b remain
node check/check-2312.cjs http://127.0.0.1:8002/   # PASS: done-one and keep-b remain
```

The other two checks take the same addresses.

## What does not count, and what to know

- Two earlier wordings of the test did not make it, each in its own throwaway repo. With every action in one
  paragraph, Kane passed the test on the unfixed app, so Proven refused it as proving nothing. With "once" added to
  every click, Kane failed it for using the delete button twice, which is about Kane, not the bug. One action per
  step gave the red above. Neither attempt is in this history (48.87 and 42.28 credits); their logs stay
  on my machine.
- Kane's reason at red is Kane's reading of its own run, so a person has to read it. I did, and started the loop only
  because `done-one` was missing.
- This is one ticket, one agent attempt, no reopen and no rejected `done`.

## How it was run

Proven pinned to `250aff3`, Kane CLI and Claude Code headless, on Nov 14 2026, with commits under my own name. The
commands under "Check it" use the later `d881f89`, which reads the same receipts and changes only how a replay is
timed and reported. Kane's evidence packs and recordings stay on my machine because they carry account ids; receipts
keep their sha256.

My code, the ticket and the checks are MIT (LICENSE). TodoMVC is MIT (LICENSE-todomvc.md). NOTICE.md lists the
vendored Mithril (MIT), todomvc-common (MIT) and todomvc-app-css (CC BY 4.0, Sindre Sorhus, unchanged).
