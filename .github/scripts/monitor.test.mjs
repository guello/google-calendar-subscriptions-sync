import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  alertKeys,
  annotate,
  checkWorkflow,
  consecutiveFailures,
  failedSync,
  hasStoppedCompleting,
  isStale,
  loadRunHistory,
  parseFailureThreshold,
  staleAfterMs,
} from './monitor.mjs'

const runs = (...conclusions) =>
  conclusions.map((conclusion, index) => ({
    id: index + 1,
    status: 'completed',
    conclusion,
  }))

test('detects a failed sync step even when the job and workflow succeed', async () => {
  const jobs = [
    {
      conclusion: 'success',
      steps: [{ name: 'Run sync-subscriptions', conclusion: 'failure' }],
    },
  ]
  assert.equal(failedSync(jobs), true)
  assert.equal(await consecutiveFailures(runs('success', 'success', 'success'), async () => jobs), 3)
})

test('uses 3 by default and validates the configured threshold', () => {
  assert.equal(parseFailureThreshold(undefined), 3)
  assert.equal(parseFailureThreshold(''), 3)
  assert.equal(parseFailureThreshold('1'), 1)
  assert.equal(parseFailureThreshold('100'), 100)
  for (const value of ['0', '-1', '1.5', '3x', '101', '9007199254740992']) {
    assert.throws(() => parseFailureThreshold(value), /SYNC_FAILURE_THRESHOLD/)
  }
})

test('counts only up to the configured threshold', async () => {
  const history = runs('failure', 'failure', 'failure')
  assert.equal(await consecutiveFailures(history, async () => [], 2), 2)
  assert.equal(await consecutiveFailures(history, async () => [], 4), 3)
})

test('loads another page when unfinished runs displace failures at the threshold', async () => {
  const first = [
    { status: 'in_progress', updated_at: new Date(100).toISOString() },
    ...Array.from({ length: 99 }, (_, id) => ({
      id,
      status: 'completed',
      updated_at: new Date(99 - id).toISOString(),
    })),
  ]
  const second = [{ id: 100, status: 'completed', updated_at: new Date(0).toISOString() }]
  const pages = []
  const history = await loadRunHistory(async page => {
    pages.push(page)
    return page === 1 ? first : second
  }, 100)
  assert.deepEqual(pages, [1, 2])
  assert.equal(history.filter(run => run.status === 'completed').length, 100)
})

test('does not mistake a job without a sync step for a successful sync', () => {
  assert.equal(
    failedSync([
      {
        conclusion: 'success',
        steps: [{ name: 'Checkout', conclusion: 'success' }],
      },
    ]),
    true
  )
})

test('stops counting on a successful run and ignores incomplete runs', async () => {
  const history = runs('failure', 'failure', 'success', 'failure')
  history.splice(1, 0, { id: 5, status: 'in_progress' })
  const jobs = [
    {
      conclusion: 'success',
      steps: [{ name: 'Run sync-subscriptions', conclusion: 'success' }],
    },
  ]
  assert.equal(await consecutiveFailures(history, async () => jobs), 2)
})

test('an older run rerun after a success counts in completion order', async () => {
  const jobs = [
    {
      conclusion: 'success',
      steps: [{ name: 'Run sync-subscriptions', conclusion: 'success' }],
    },
  ]
  assert.equal(await consecutiveFailures(runs('failure', 'success', 'failure', 'failure'), async () => jobs), 1)
})

test('treats a failed setup and a cancellation as unsuccessful', async () => {
  assert.equal(await consecutiveFailures(runs('failure', 'cancelled', 'failure'), async () => []), 3)
})

test('alerts if no workflow started in the health window', () => {
  assert.equal(isStale([], 100000000), true)
  assert.equal(isStale([{ created_at: new Date(100000000 - staleAfterMs + 1).toISOString() }], 100000000), false)
  assert.equal(isStale([{ created_at: new Date(100000000 - staleAfterMs - 1).toISOString() }], 100000000), true)
  assert.equal(
    isStale(
      [
        { created_at: new Date(100000000 - staleAfterMs - 1).toISOString() },
        { created_at: new Date(100000000).toISOString() },
      ],
      100000000
    ),
    false
  )
})

test('alerts if recent runs have not completed', () => {
  const now = 100000000
  assert.equal(hasStoppedCompleting([{ status: 'in_progress' }], now), true)
  assert.equal(
    hasStoppedCompleting(
      [
        {
          status: 'completed',
          updated_at: new Date(now - staleAfterMs + 1).toISOString(),
        },
      ],
      now
    ),
    false
  )
  assert.equal(
    hasStoppedCompleting(
      [
        {
          status: 'completed',
          updated_at: new Date(now - staleAfterMs - 1).toISOString(),
        },
      ],
      now
    ),
    true
  )
})

test('reports the problem of an unhealthy workflow with a stable key', async () => {
  const now = 100000000
  const recent = new Date(now).toISOString()
  const history = ['failure', 'failure', 'failure'].map((conclusion, id) => ({
    id,
    status: 'completed',
    conclusion,
    created_at: recent,
    updated_at: recent,
    html_url: `run-${id}`,
  }))
  assert.deepEqual(await checkWorkflow('sync-subscriptions.yml', history, async () => [], now, 3), {
    key: 'sync-subscriptions.yml:failing',
    message: 'sync-subscriptions.yml failed 3 consecutive runs: run-0',
  })
  assert.equal(await checkWorkflow('sync-subscriptions.yml', history, async () => [], now, 4), undefined)
  assert.equal(
    (await checkWorkflow('sync-subscriptions.yml', [], async () => [], now)).key,
    'sync-subscriptions.yml:stale'
  )
})

test('fails only for problems the previous monitor run did not report', () => {
  const problems = [
    { key: 'sync-subscriptions.yml:failing', message: 'subscriptions failed' },
    { key: 'sync-subscriptions.yml:stale', message: 'subscriptions stale' },
  ]
  const reported = alertKeys([
    { message: '[monitor:sync-subscriptions.yml:failing] subscriptions failed' },
    { message: 'Process completed with exit code 1.' },
  ])
  assert.deepEqual([...reported], ['sync-subscriptions.yml:failing'])
  assert.deepEqual(annotate(problems, reported), [
    '::warning::[monitor:sync-subscriptions.yml:failing] subscriptions failed (already alerted)',
    '::error::[monitor:sync-subscriptions.yml:stale] subscriptions stale',
  ])
})

test('alerts again after a problem clears and returns', () => {
  const problems = [{ key: 'sync-subscriptions.yml:failing', message: 'subscriptions failed' }]
  assert.deepEqual(annotate(problems, alertKeys([])), [
    '::error::[monitor:sync-subscriptions.yml:failing] subscriptions failed',
  ])
})
