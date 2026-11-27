# Coordinator resolutions to the blind specs

Recorded 2026-11-27. These resolutions do not change any edit's intent or breakage type.

## Edit 1.5: Pay and Request buttons swapped

**Problem.** Moving Pay before Request in DOM order changes implicit form submission. Pressing Enter clicks the first enabled submit button, so it would send a payment instead of a request (found while building v1). The plan requires that the app's behavior stays the same.

**Resolution.** Swap the buttons in DOM order, as the spec says: this is the position change behind the structure-locator breakage. Also handle implicit submission explicitly, so that pressing Enter in the form still submits a Request, exactly as at 0729f68. Clicking either button behaves as before.

**Check.** On v1 and v2:
- pressing Enter in a valid form creates a request;
- clicking Pay creates a payment;
- clicking Request creates a request.

**Interaction with edits 2.2 and 2.3.** In v2 the toggle starts unselected. Enter in a valid transaction text field selects Request and opens the same review dialog reached by selecting Request and clicking Continue. Confirm creates the request. This preserves the keyboard transaction type and keeps confirmation mandatory. Pay and Request still select their respective types and proceed through Continue and Confirm.
