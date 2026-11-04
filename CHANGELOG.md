# Changelog

Each version matches a commit on `main`. Tag `vX.Y.Z` points at that commit.

## v0.8.0: Parent star adjuster
Commit `ee24083`

- **⭐ Adjust stars** on a kid's rewards screen lets a parent take or add a star, or set an exact total. It sits behind the parent PIN when one is set.
- −1 and ＋1 use `counter.decrement` / `counter.increment`, so they're safe with several screens open. Set to replaces the total.

## v0.7.0: Chores on chosen days
Commit `891d0e5`

- Chores can run on chosen days: pick them in the chore form, or write `mon,thu`, `weekdays`, `weekends` or a day name in the description. On other days the chore is hidden and left out of the progress count; edit mode still shows it, dimmed, with its days.
- Stars are added and taken with `counter.increment` / `counter.decrement`, so two screens changing stars at once can't overwrite each other. Keep each star counter's step at 1.
- Buying a reward re-checks the balance when the parent confirms.

## v0.6.0: Lists on Today
Commit `4b26a2c`

- Choose which lists show on the Today screen with a per-list **Show on Today** switch. They stack in order.
- With more than one, each shows 5 items (`today_list_items`), then a "+ N more" link to the Lists tab.
- With none switched on, the first list shows, as before.
- Editor: Show on Today switch, Today badge on the list row, items-per-list setting.

## v0.5.0: Photos and owed rewards
Commit `234200e`

- Person photos replace initials on chips, Planner columns and chore rings. Per-person `picture` override and a `hide_pictures` option.
- No home/away dot for people without a tracker.
- `rewards_owed_list`: every redeemed reward is recorded with the kid, cost and date until a parent marks it given.
- Owed panel on the Chores tab with Given, Undo and Refund (behind the parent PIN when one is set).
- A kid's rewards screen shows what they're waiting on, and Today shows an owed count.

## v0.4.0: Visual editor
Commit `2258a21`

- Card editor in the dashboard's Edit card screen: general settings, people, shared calendars, lists, chores and rewards, planner and layout.
- Color pickers, reorder arrows, add and remove (remove asks once).
- New cards start pre-filled from existing people, calendars, weather and to-do lists.
- The card handles live reconfiguration: no double taps, lists resubscribe and calendars refetch when changed.

## v0.3.0: Planner and dark mode
Commit `695fe75`

- Planner view: a column per person plus a shared column, a red line at the current time, overlapping events side by side, tap an empty hour to add an event.
- Dark mode: header button cycles Light, Dark, Auto (follows Home Assistant) and Sunset (dark after sunset), saved per screen.

## v0.2.0: First release
Commit `aa67830`

- Today, Week, Month, Chores and Lists views for a wall tablet, with a phone layout.
- Calendars color-coded per person, "[Name] - Event" titles assigned to that person.
- Chore charts by time of day with stars, a nightly reset, and rewards kids can buy with stars.
- Chores and rewards editable from the card, with an optional parent PIN.
