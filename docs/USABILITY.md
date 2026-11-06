# Usability

No outside participants have used Contour yet. This file holds a task script for when they do, and a heuristic review I did myself. The review is not user research.

## Task script

Run this with 3 to 5 people who make visual work and have not seen the tool. Use a laptop with a pointer. Say: "Think aloud. I am testing the tool and not you. I will not help unless you are stuck for two minutes." Record task completion, time, and every point of hesitation. Do not record anything that identifies them.

1. You need a quiet line drawing behind a heading. Start from an empty sheet and make a shape with one high point and one long ridge.
2. Move the high point so that the lines bunch up on the left.
3. Make the lines closer together, and add a slight wander.
4. You changed your mind. Go back to before you added the wander.
5. Save your work, close the tab, and open it again.
6. Export a file that is under 20 KB. Tell me how far the exported lines may sit from the exact lines.
7. Open the file somewhere else.

Follow up: What did "Line detail" mean to you? What did the status line tell you during a drag? What would you remove?

## Heuristic review (self review)

I reviewed real renders against Nielsen's heuristics. Severity is 0 to 3.

| Heuristic | Finding | Severity | Action |
|---|---|---|---|
| Visibility of status | The status line says Draft, Refining or Export geometry, with the grid and time | 0 | None |
| Match with the real world | "Line detail" is less exact than "tolerance", but it names what changes | 1 | Test in task 6 |
| User control | Undo covers every scene edit, opening a file and loading a starter | 0 | None |
| Consistency | Sources can be selected from the list or the sheet, and both show the same selection | 0 | None |
| Error prevention | Invalid numbers are refused with the allowed range. A bad file changes nothing | 0 | None |
| Recognition over recall | All tools have a label and shortcut in a tooltip, and `?` lists all shortcuts | 0 | None |
| Flexibility | Pointer, keyboard, number entry and touch all reach the same edits | 0 | None |
| Minimal design | Ridge spines and reach rings show only for the selected source | 0 | Fixed in review |
| Help with errors | File errors name the exact field, but use internal names such as `domain.width` | 2 | Next improvement |
| Help and documentation | Field hints exist, but "Grid error" needs an explanation at the point of use | 2 | Next improvement |

A negative source on empty ground draws nothing, because no line sits below 0 there. That can look broken to a new user. Severity 2. The first line control does fix it, but nothing points there yet.

## Accessibility limits

The automated axe scan reports no serious issue in the states it covers. That does not establish accessibility.

- The canvas is an image to a screen reader, with a summary label. Handles are real buttons with names, and every edit is available through them and the panels.
- Keyboard users reach handles by Tab, which selects them, then use arrows.
- Reach dragging has no keyboard path on the handle, but `[`, `]` and the Reach field do the same job.
- A screen reader user cannot perceive the drawing itself. The tool is visual by nature, and this is a real limit.
- I have not tested with an actual screen reader.
