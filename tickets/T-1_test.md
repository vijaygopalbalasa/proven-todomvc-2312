---
mode: testing
---

# T-1: Deleting an active todo from the Active view removes that todo

## Open the start page
Open http://localhost:8098/
Verify the text "todos" is shown on the page.

## Add three todos
Type done-one in the What needs to be done field and press Enter. Type keep-a in the same field and press Enter. Type keep-b in the same field and press Enter.
Verify the list shows three todos: done-one, keep-a and keep-b.

## Complete done-one
Click the round checkbox next to done-one.
Verify done-one is struck through and the counter reads 2 items left.

## Open the Active view
Click Active at the bottom of the list.
Verify the Active link is highlighted and the list shows keep-a and keep-b.

## Delete keep-a
Click the cross (delete) button at the right end of the keep-a row.
Verify the Active link is still highlighted.

## Back to All
Click All at the bottom of the list.
Verify the list shows exactly two todos, done-one and keep-b, and keep-a is not in the list.
