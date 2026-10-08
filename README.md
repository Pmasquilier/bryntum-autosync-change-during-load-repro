# autoSync never sends a change made while a load or sync response is applied

Minimal repro for Bryntum support. Scheduler Pro 7.3.7, plain JS + Vite, the stock CrudManager transport
(`loadUrl` / `syncUrl` mocked with `AjaxHelper.mockUrl`), `autoSync: true`, `lazyLoad: true`.

## Run

```sh
npm install   # needs access to npm.bryntum.com (licensed or trial account)
npm run dev
```

Open http://localhost:5191/ and click one of the two buttons, or let a script click them in a fresh page each:

```sh
npm run dev     # in one terminal
npm run repro   # in another
```

## What happens

A user edit can land while the project is applying a server response: applying waits on the engine commit, so the
window is real, and it widens with the amount of data. The repro makes the edit land there on every run by queueing it
from `beforeLoadCrudManagerData` / `beforeSyncCrudManagerData`. The page logs `isChangeTrackingSuspended` at the moment
of the edit to show where it landed.

**1. Removing an event while a lazy-loaded page is applied** — the removal is discarded. The bar is gone, no sync request
is sent, and `crudStoreHasChanges()` is back to `false`, so nothing will ever send it.

```
removed event 1 — change tracking suspended at that moment: true
during a lazy-loaded page: pending changes = false, sync requests so far = 0
```

**2. Removing an event while a sync response is applied** — the removal stays staged and is never sent. A first removal
syncs; a second one made during that sync's response is pending forever, until some later edit happens to schedule a sync.

```
removed event 2 — triggers a sync
sync request sent: events {"removed":[{"id":2}]}
removed event 3 — change tracking suspended at that moment: true
during a sync response: pending changes = true, sync requests so far = 1
```

A removal made outside both windows syncs normally.

## Expected

Every user change ends up in a sync request: once the response is applied, a change made meanwhile is either sent or
at least still pending with a sync scheduled for it.

## Where it comes from (7.3.7 source)

- `AbstractCrudManagerMixin.onCrudStoreChange` returns early while `crudIgnoreUpdates` is set, so a change made while
  change tracking is suspended schedules no autoSync.
- Both response paths resume tracking with `resumeChangeTracking(true)` — `doAfterLoadCrudManagerData` and
  `doAfterApplySyncResponse` — which skips the change check, so nothing schedules the sync afterwards.
- On the load path the removal does not even stay pending: right after the edit `eventStore.removed` holds it, once the
  page is applied it is empty again. That is why case 1 ends with no pending change at all.

Case 2 is what https://github.com/bryntum/support/issues/8263 ("CRUD manager loses changes when applying sync response")
describes, closed as resolved in 2024 and still reproducing on 7.3.7. Case 1 is its load-side sibling.
