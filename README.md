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
