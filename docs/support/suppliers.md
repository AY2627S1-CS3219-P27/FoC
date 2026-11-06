---
title: Suppliers
service: supplier-service
audience: user
last_reviewed: 2026-11-06
---

# Suppliers

## What is a supplier in FoC?

A supplier is a place on campus where an errand's item is collected. It has one of three types: a store, a facility such as a printer, or a landmark. A supplier is a pickup point, not an online shop: FoC has no menus, products, stock or prices. You describe what you need collected in the errand itself.

Each supplier has a name, one or more categories such as Food or Coffee, a building, a floor, a description of how to find it, and a map position. Its display name combines the name and building, such as "Printer @ COM2".

## How do I find a supplier?

Open the suppliers list while signed in. You can search by name, and the search ignores capital letters and matches part of a name. You can also filter by building, category, type and status, and sort the results. Filters can be combined, so you could look for Coffee suppliers in one building.

Buildings can be found by any of their names. For example, COM3 is also known by its full name and as Terrace.

## What is the difference between an Active and an Inactive supplier?

An **Active** supplier is available to use. An **Inactive** supplier is closed or out of use, but it stays in FoC so that past errands remain accurate. You cannot run a new errand from an Inactive supplier: if you try, the errand is cancelled with the reason `SUPPLIER_UNAVAILABLE`, and no credits are taken.

## How do I ask for a new supplier to be added?

Any signed-in user can ask for a supplier to be added, with its name, type, categories, building, floor, how to find it, and its map position. The floor is written as B1 to B9, 1 to 99, or M. The map position must be on the NUS campus. The request then waits as Pending for an admin. The supplier does not appear in the list until an admin approves it.

Your request is refused straight away if the supplier already exists, which means the same name on the same floor of the same building, or if an identical request is already waiting.

## What counts as a duplicate supplier?

Two suppliers are duplicates when they have the same name on the same floor of the same building. FoC ignores capital letters and extra spaces when comparing, so "Cool Spot" and "cool  spot" count as the same name. The same business can have outlets on different floors or in different buildings, because each outlet is its own supplier.

## How do I suggest a change to a supplier's details?

Any signed-in user can propose a change to an existing supplier, such as a corrected floor or location description. The supplier stays as it is until an admin approves. A supplier can only have one pending edit at a time. If the supplier has been changed since you opened it, reload it and try again.

## How do I ask for a supplier to be marked Active or Inactive?

Any signed-in user can ask for a supplier's status to change, for example if a shop has closed for good. You can add a reason. An admin then approves or denies it. The request is refused if the supplier already has that status, or if a status change for it is already waiting.

## What do the supplier request states mean?

A supplier request can be in one of four states:

- **Pending:** waiting for an admin to decide.
- **Approved:** an admin accepted it, and the change has been made.
- **Denied:** an admin refused it and gave a reason.
- **Withdrawn:** the person who filed it took it back.

Approved, Denied and Withdrawn are final. You can see all your own requests and their states under your requests.

## Why was my supplier request denied?

An admin denies a request when it should not go ahead, for example when it is incorrect or a duplicate, and must give a reason. You can read the reason in your list of requests. An admin may also deny a request that has become out of date, such as an edit to a supplier that has changed since you filed it. If the problem can be fixed, file a new request with the corrected details.

## Can I cancel a supplier request I filed?

Yes, while it is still Pending. Withdraw it from your list of requests, and you can file it again later if you need to. You can only withdraw your own requests. Once a request is Approved or Denied it cannot be withdrawn.

## Can I see other people's supplier requests?

No. You can only see your own requests. Admins can view all of them.

## Who can change suppliers directly in FoC?

Only admins can create, edit or deactivate a supplier directly. Everyone else asks through a supplier request, which an admin reviews. If two people change the same supplier at once, FoC accepts the first change and refuses the second, which must reload the latest details and try again, so nobody silently overwrites someone else's change.

## Do opening hours stop me creating an errand?

No. A supplier may show opening hours and whether it is open now, but this is for information only. FoC does not block an errand because a supplier is closed at that moment, so check the hours before you post. A supplier may also have no hours listed.

## What is a brand on a supplier?

A brand groups outlets of the same business, such as several branches of one shop. Each outlet is still its own supplier with its own building, floor and hours. Searching for the brand's name finds all its outlets. Not every supplier has a brand, and only admins create brands, though you can choose an existing brand when you file a request.
