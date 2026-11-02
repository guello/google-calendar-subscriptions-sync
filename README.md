[ci-badge]: https://github.com/guello/google-calendar-subscriptions-sync/actions/workflows/sync-subscriptions.yml/badge.svg

# Google Calendar Subscriptions Sync

![sync-subscriptions][ci-badge]

Collection of actions to sync calendar events using [Google Calendar Subscriptions](https://github.com/guello/google-calendar-subscriptions).

## Installation

Install the modules with a package manager of your choice:

```sh
pnpm install
```

## Configuration

Create a `.env` file and populate it with arbitrary credentials of the service accounts you will use. These variables MUST have an arbitrary prefix and end with `CLIENT_EMAIL` and `PRIVATE_KEY`:

```sh
PERSONAL_CLIENT_EMAIL=my-service-account@project-1.iam.gserviceaccount.com
PERSONAL_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n---END PRIVATE KEY-----\n"

WORK_CLIENT_EMAIL=my-service-account@project-2.iam.gserviceaccount.com
WORK_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n---END PRIVATE KEY-----\n"

# ...
```

Register the details of the subscriptions that will be synced. Each variable must start with an arbitrary prefix that will be used as the subscription ID:

```sh
MY_SUBSCRIPTION_CALENDAR_ID=*******@group.calendar.google.com
MY_SUBSCRIPTION_SUBSCRIPTION_URL=https://ics.fixtur.es/v2/ac-milan.ics
MY_SUBSCRIPTION_USER=PERSONAL
# ...
```

### Customizing subscriptions

Custom subscriptions can be defined in `src/subscriptions` and must be named as the subscription ID. Each subscription must export a function that transforms the events fetched from the subscription source:

```ts
// src/subscriptions/my-subscription/index.ts

import { calendar_v3 } from 'google-calendar-subscriptions'

const transformEvents = (events: calendar_v3.Schema$Event[]) => {
  return events.map(event => {
    // ...
  })
}

export default transformEvents
```

## Actions

Run an action with:

```sh
pnpm action <action-name> [subscriptions]
```

If no subscriptions are provided, all subscriptions will be used.

### `sync`

Fetch events from the subscriptions and update the related Google Calendar:

```sh
pnpm action sync [subscriptions]
```

### `clear`

Remove all events from the calendar associated with the subscriptions:

```sh
pnpm action clear [subscriptions]
```

### `insert`

Create a new calendar and insert the events from the subscriptions:

```sh
pnpm action insert [subscriptions]
```

## Failure alerts

The [Sync Subscriptions](.github/workflows/sync-subscriptions.yml) workflow tolerates a failed sync at the job level, so a single transient error does not send a notification. Its errors stay visible in the run logs.

The [Monitor](.github/workflows/monitor.yml) workflow runs after each completed sync run and every 15 minutes. It flags the sync workflow after consecutive unsuccessful runs, or when no run started or completed in the last 30 minutes. A successful run resets the count. The threshold defaults to 3. To change it, set the repository Actions variable `SYNC_FAILURE_THRESHOLD` to an integer from 1 to 100. Invalid values fail the monitor rather than disabling alerts.

Each problem alerts once: the monitor fails only for problems that its previous run did not report, and logs ongoing problems as warnings. A problem that clears and returns alerts again. Failures of the monitor workflow send GitHub Actions failure notifications when you have enabled them in your GitHub notification settings.

The Monitor workflow also runs a daily keep-alive job. GitHub disables scheduled workflows in public repositories after 60 days without activity, so the job adds an empty commit when the last commit is more than 50 days old.
