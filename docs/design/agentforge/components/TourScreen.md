# TourScreen

The tour on the real frame: step 5 pointing at the full-width status bar (the card below it, its notch pointing up), and step 6 in a narrow window pointing at the side list footer (the card above it and to its right, its notch pointing down). Switch the page's theme to see both in light and dark. See TourCard and ViewFooter.

- The backdrop is transparent: the page under the card stays visible and unchanged.
- The status bar's highlight is drawn inside it, so it never collides with the window edge or the side list.
- The card covers part of the page but never its target; when the target is at the bottom (step 6), the card goes above.
