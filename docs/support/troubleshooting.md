---
title: Troubleshooting
service: general
audience: user
last_reviewed: 2026-11-06
---

# Troubleshooting

## My errand has been Pending for a long time. What should I do?

Cause: FoC is still checking the supplier or holding your credits, which usually takes seconds. One of those steps may be delayed.

What to do: wait. FoC never leaves an errand Pending for good. If the supplier check gets no answer for 30 minutes, or holding your credits gets no answer for 5 minutes, the errand is cancelled and no credits are lost. You can then create it again. If this keeps happening, contact an admin.

## My errand was cancelled straight after I created it. What happened?

Cause: one of the checks on a new errand failed. The usual reasons are that the supplier is Inactive or no longer exists (`SUPPLIER_UNAVAILABLE`), the delivery building is unavailable (`BUILDING_UNAVAILABLE`), or you did not have enough available credits (`INSUFFICIENT_CREDITS`).

What to do: read the cancellation reason on the errand. Choose another supplier or building, or lower the reward, and create the errand again. No credits are taken from a cancelled errand.

## Nobody has accepted my errand. What can I do?

Cause: no courier has chosen it yet. If that continues until its open time ends, the errand is cancelled with the reason `ERRAND_EXPIRED`, and your credits return.

What to do: while the errand is Open you can raise the reward to make it more attractive. You can also set a longer open time on your next errand, up to 168 hours.

## My credits look lower than expected. Where did they go?

Cause: credits for your unfinished errands are reserved, which takes them out of your available balance before anything is paid.

What to do: compare your available and reserved balances, then look through your unfinished errands. Reserved credits come back if the errand is cancelled, and go to the courier if it is completed. If the numbers still look wrong after that, contact an admin.

## My courier picked up the item but has not delivered it. What should I do?

Cause: the courier may simply be on the way, or may have run into a problem. You cannot cancel an errand once a courier has accepted it.

What to do: message the courier in the errand's chat. If it is not marked as delivered within 24 hours of pickup, FoC cancels the errand automatically and returns your credits.

## My errand says Delivered but I did not get the item. What should I do?

Cause: the courier has marked it as delivered, which may be a mistake or a real problem.

What to do: act within 24 hours, because after that FoC confirms the delivery automatically and pays the courier. Message the courier first. If it cannot be sorted out, mark the delivery as incomplete. Your credits stay held and an admin will decide what happens to them.

## I delivered an errand but have not received my credits. Why?

Cause: the requester has not confirmed yet, or they have disputed the delivery.

What to do: check the errand's status. If it is Delivered, FoC pays you automatically within 24 hours if the requester does nothing. If it is Incomplete, an admin will decide; you can file a report. If it is Completed but your balance has not changed, wait a moment and refresh. If it still has not changed, contact an admin.

## I cannot accept an errand. What is wrong?

Cause: you may not have the courier role, you may already hold an Accepted or Picked Up errand, another courier may have accepted it first, its open time may have ended, or it may be your own errand.

What to do: check your role on the My Account page, and finish your current errand before taking another. Choose a different errand if this one has gone.

## I cannot create an errand. What is wrong?

Cause: you may not have the requester role, a required field may be missing, or the reward may not be a whole number of at least 1 credit. The open time must also be between 15 minutes and 168 hours.

What to do: check your role on the My Account page, then read the message shown on the form, which lists every field that needs fixing. If the errand is created but later cancelled, read its cancellation reason instead.

## My new account shows no credits. What should I do?

Cause: your 100 starting credits are set up just after your account, so they can take a moment to appear.

What to do: wait a moment and refresh the page. FoC keeps the registration message until credits are set up, so a delay does not lose them. If you still have no credits after that, contact an admin.

## My sign-up code or reset link does not work. What should I do?

Cause: both last only 10 minutes, and asking for a new code replaces the old one.

What to do: request a new one and use the latest email. Check your junk folder if nothing arrives. For sign-up, check that your address ends in `@u.nus.edu` or `@nus.edu.sg`.

## I cannot sign in to FoC. What should I do?

Cause: the password may be wrong, or the account may be locked after 10 failed attempts in a row.

What to do: use the forgotten password option on the sign-in page. Resetting your password also unlocks a locked account. If you still cannot sign in, contact an admin.

## My supplier request was refused straight away. Why?

Cause: FoC checks a request when you file it. It refuses a new supplier that already exists, a request identical to one already waiting, or an edit to a supplier that already has a pending edit. It also refuses an edit if the supplier has changed since you opened it.

What to do: search for the supplier first in case it already exists. For an out-of-date edit, reload the supplier and file it again.

## How do I get help with a problem the help bot cannot answer?

If this help bot cannot answer your question, or something on your account looks wrong, contact an admin.
