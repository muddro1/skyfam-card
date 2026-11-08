# Changelog

Each version matches a commit on `main`. Tag `vX.Y.Z` points at that commit.

## v0.11.0: Drag to reorder chores
Commit `7319602`

- **Reorder chores**: in **✏️ Edit chores**, drag a chore by its ⠿ grip to move it up or down within its time of day. Works with touch. The order is saved to the to-do list, so every screen (and Today) shows it. To move a chore to another time of day, edit it.

## v0.10.1: Events for more than one person
Commit `cfb4b9a`

- A new event can be for several people: tick more than one. Each gets a copy on their calendar, and the copies show as one event in everyone's colors. If saving stops partway, trying again skips the calendars already saved.
- A shared calendar entry with no calendar (left over from **＋ Add shared calendar**) no longer shows as an extra chip. Remove it in the editor: it's marked "No calendar".

## v0.10.0: Setup buttons, edit and delete events, repeating events
Commit `5dfdcbf`

- **Setup from the card editor** (admins): each person without a chore list or star counter gets a **✨ Create a chore list and star counter** button. **Chores and rewards** has **✨ Create rewards lists** and **🌙 Create the nightly chore reset**. They create the Local To-do lists, counters (step 1, minimum 0) and the reset automation, and fill them in. Press the reset button again after adding a kid.
- **Edit and delete events** from the event details. Repeating events offer this one, or this one and every later one. The buttons only show when the calendar supports them.
- **Repeating events**: new events can repeat every day, week, 2 weeks, month or year, on chosen weekdays, until an optional date. The details show the rule in words.
- **Notes** on new and edited events.
- **Same event, two calendars**: an event with the same title, times and location on two people's calendars shows once, in both colors and both Planner columns. Edits and deletes apply to every copy.
- Events are now created with the calendar websocket API instead of `calendar.create_event`, with times in the screen's time zone.

## v0.9.1: Move chores between kids
Commit `0e1ec15`

- Editing a chore now lets you change who it's for. Untick the kid and tick another to move it; tick extra kids to copy it to them. The copy is added before the original is removed, so a failed save loses nothing.

## v0.9.0: One-off chores, Today options, tab order
Commit `1c2de42`

- A chore can be for one date only: pick it in the chore form (or tap **Today**), or write a date like `2026-11-04` in the description. It shows only on that date; edit mode shows it dimmed with its date on other days.
- Today: `today_past_events: hide` removes events once they end, instead of greying them out.
- Today: `event_weather: true` shows the forecast on each event, from the hourly forecast near its start (daily for all-day events).
- `tabs` sets the order of the tabs and hides any left out. The editor has a drag-to-reorder list for it.
- The example nightly reset automation now also deletes one-off chores once their date has passed. Re-paste it from `examples/reset-chores-automation.yaml` to get this.

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
