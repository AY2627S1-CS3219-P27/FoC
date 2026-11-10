---
title: Errands
service: order-service
audience: user
last_reviewed: 2026-11-06
---

# Errands

## What is an errand?

An errand is one request for an item to be collected from a campus supplier and delivered to a building on campus. It starts when a requester creates it and ends when it is completed, cancelled or resolved. The requester chooses the supplier, the delivery building and room or level, describes what to collect, and offers a reward in credits.

## How do I create an errand?

You need the requester role and enough available credits. Fill in:

- the supplier to collect from
- the delivery building, and the room or level within it, up to 200 characters
- the items to collect, up to 1,000 characters, such as "1 large iced milo, less sugar"
- an optional note for the courier, up to 1,000 characters
- the credits you offer, which must be a whole number of at least 1; 10 to 20 credits is typical
- how long the errand stays open, from 15 minutes to 168 hours (7 days); the default is 60 minutes

The errand first shows as Pending while FoC checks the supplier and holds your credits. It then becomes Open, and couriers can see it. Pressing create twice by accident does not create two errands.

## What do the errand statuses mean?

An errand can show these statuses:

- **Pending:** FoC is checking the supplier and holding the requester's credits.
- **Open:** waiting for a courier to accept it.
- **Accepted:** a courier has taken it and is on the way to collect.
- **Picked Up:** the courier has collected the item.
- **Delivered:** the courier says it was delivered; the requester should now confirm.
- **Processing transfer:** the delivery was confirmed and FoC is moving the credits to the courier. It usually takes a moment. If the transfer cannot be completed, the errand becomes Incomplete.
- **Completed:** finished, and the reward has gone to the courier.
- **Cancelled:** stopped, and any credits held for it are returned to the requester.
- **Incomplete:** the delivery is disputed, and an admin needs to decide. The credits stay held until then.
- **Resolved:** an admin has settled the dispute and shared out the credits.

## What happens if a supplier changes after I create an errand?

An errand keeps the pickup details from when it was created, so the courier goes where the errand says. If the supplier is later renamed or moved, your errand does not change. If the supplier later becomes Inactive, your errand carries on, and only new errands are stopped.

## Why is my errand stuck in Pending?

A new errand stays Pending while FoC checks that the supplier is available and holds your credits. This normally finishes within seconds, so please wait a little. An errand does not stay Pending forever: if these checks take too long, it is cancelled and no credits are lost. You can then create the errand again.

## Why was my errand cancelled, and what does the reason on it mean?

A cancelled errand shows a reason, which tells you what happened:

- `SUPPLIER_UNAVAILABLE`: the supplier no longer exists or is Inactive. Pick another supplier.
- `BUILDING_UNAVAILABLE`: the delivery building is not available. Pick another building.
- `SUPPLIER_VALIDATION_TIMEOUT`: checking the supplier took too long. Try again.
- `INSUFFICIENT_CREDITS`: you did not have enough available credits for the reward.
- `MISSING_BALANCE`: FoC could not find your credits. Contact an admin.
- `CREDIT_TIMEOUT`: holding your credits took too long. Try again.
- `ERRAND_EXPIRED`: no courier accepted the errand before its open time ended.
- `PICKUP_TIME_EXCEEDED`: the errand was not delivered within 24 hours of being picked up.
- `REQUESTER_CANCELLED`: the requester cancelled it.

Any credits held for a cancelled errand go back to the requester.

## How long does an errand stay open, and what happens when it expires?

The requester chooses how long an errand stays Open, from 15 minutes to 168 hours, with a default of 60 minutes. The time starts when the errand becomes Open, so time spent in Pending does not count. If no courier accepts it in time, the errand is cancelled and the held credits go back to the requester. An expired errand shows as Cancelled.

## Can I cancel my errand as a requester?

A requester can only cancel while the errand is Open, before a courier accepts it. The held credits then go back to you. Once a courier has accepted the errand you can no longer cancel it. If the courier does not deliver, the errand is either released by the courier or cancelled automatically 24 hours after pickup.

## Can I change the reward on my errand?

Yes, while the errand is Open and no courier has accepted it. The new reward must be a whole number of at least 1 credit. FoC then moves the difference between your available and reserved credits. You can change it several times. If you do not have enough available credits for a higher reward, the change is refused and the reward stays as it was.

## How do I accept an errand as a courier?

You need the courier role. Browse the open errands, which you can filter by pickup building, delivery building and minimum credits, and sort by soonest expiring, newest or highest reward. Your own errands and expired ones are left out of the list.

Choose an errand and accept it. Only one courier can win an errand: if someone else accepts first, your attempt is refused. If the requester cancels at the same moment you accept, only the first of the two succeeds. You also cannot accept an errand after its open time has ended.

## Why can I not accept another errand?

A courier can only hold one active errand at a time. An errand counts as active while it is Accepted or Picked Up. Deliver your current errand, or withdraw from it if you have not picked it up, and you can accept another. Other reasons an accept is refused are that another courier got there first, or that the errand's open time has ended.

## Can a courier give up an errand after accepting it?

Yes, before picking the item up. The courier withdraws and must give a reason. The errand goes back to Open so another courier can accept it, and the credits stay held. Once the item is picked up, the courier cannot withdraw.

## What happens if a courier does not deliver after picking up?

A courier has 24 hours from pickup to mark the errand as delivered. If they do not, the errand is cancelled automatically, and the held credits go back to the requester.

## What do I do when my errand is delivered?

When the courier marks the errand as Delivered, check that you received the item. Then either confirm the delivery, which sends the reward to the courier, or mark the delivery as incomplete if something is wrong. If you do neither within 24 hours, FoC confirms it automatically and the courier is paid.

## What happens if there is a problem with a delivery?

If the delivery is wrong or never arrived, the requester marks it as incomplete within 24 hours of it being marked Delivered. The errand becomes Incomplete, and the credits stay held. Each side can file one written report of up to 2,000 characters. The other person never sees your report; the admin does. A report cannot be changed after it is filed.

An admin then decides how much of the reward the courier receives, from nothing to the full amount, and the requester gets the rest. The errand becomes Resolved. You see the amount and the admin's note at that point. Reports lock once the admin starts settling the dispute.

## What happens if I press a button twice or my connection drops?

Repeating an action is safe. If you press confirm twice, or try again after your connection drops, nothing happens twice, so a courier is never paid twice. If an action no longer applies because the errand has moved on, FoC tells you it could not be done. Refresh the errand to see where it is now.

## How do I see my past errands?

The My Errands view lists the errands you created and the errands you delivered, newest first. You can filter by your role in the errand and by status, so you can look up finished errands too. Anyone involved in an errand can see it in any status. Other users can only see an errand while it is Open and not expired, and they get a "not available" message otherwise.

## How do I talk to the other person on an errand?

When a courier accepts an errand, FoC opens a private chat between the requester and that courier. See the chat help section for how it works and when it closes.
