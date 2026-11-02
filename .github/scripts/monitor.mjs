import { readFile } from 'node:fs/promises'

export const workflows = ['sync-subscriptions.yml']
export const parseFailureThreshold = value => {
  if (value === undefined || value === '') return 3
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 100)
    throw new Error('SYNC_FAILURE_THRESHOLD must be an integer between 1 and 100')
  return Number(value)
}
export const failureThreshold = parseFailureThreshold(process.env.SYNC_FAILURE_THRESHOLD)
export const staleAfterMs = 30 * 60 * 1000
export const monitorWorkflow = 'monitor.yml'
export const monitorJob = 'monitor'

const alertTag = /\[monitor:([^\]]+)\]/

/**
 * Returns the problem of a sync workflow, or undefined when it is healthy.
 */
export const checkWorkflow = async (workflow, runs, getJobs, now = Date.now(), threshold = failureThreshold) => {
  if (isStale(runs, now))
    return { key: `${workflow}:stale`, message: `${workflow} has not started for at least 30 minutes` }
  if (hasStoppedCompleting(runs, now))
    return { key: `${workflow}:stopped`, message: `${workflow} has not completed for at least 30 minutes` }
  const failures = await consecutiveFailures(runs, getJobs, threshold)
  console.log(`${workflow}: ${failures} consecutive unsuccessful runs`)
  if (failures < threshold) return
  const latest = runs.find(run => run.status === 'completed')
  return {
    key: `${workflow}:failing`,
    message: `${workflow} failed ${failures} consecutive runs: ${latest.html_url}`,
  }
}

/**
 * Reads the alert keys tagged in the annotations of a monitor run.
 */
export const alertKeys = annotations =>
  new Set(annotations.map(({ message }) => message?.match(alertTag)?.[1]).filter(Boolean))

/**
 * Formats problems as annotations: new problems are errors, problems already reported by the previous run are warnings.
 */
export const annotate = (problems, reported) =>
  problems.map(({ key, message }) =>
    reported.has(key)
      ? `::warning::[monitor:${key}] ${message} (already alerted)`
      : `::error::[monitor:${key}] ${message}`
  )

export const failedSync = jobs =>
  jobs.some(job => {
    const sync = job.steps?.find(step => step.name?.startsWith('Run sync-'))
    return job.conclusion !== 'success' || !sync || sync.conclusion !== 'success'
  })

export const consecutiveFailures = async (runs, getJobs, threshold = failureThreshold) => {
  let failures = 0
  for (const run of runs) {
    if (run.status !== 'completed') continue
    if (run.conclusion === 'success' && !failedSync(await getJobs(run.id, run.run_attempt))) break
    failures++
    if (failures === threshold) break
  }
  return failures
}

export const isStale = (runs, now = Date.now()) =>
  !runs.length || now - Math.max(...runs.map(run => Date.parse(run.created_at))) > staleAfterMs

export const hasStoppedCompleting = (runs, now = Date.now()) => {
  const completed = runs.find(run => run.status === 'completed')
  return !completed || now - Date.parse(completed.updated_at) > staleAfterMs
}

export const loadRunHistory = async (getPage, threshold = failureThreshold) => {
  const runs = []
  for (let page = 1; page <= 10; page++) {
    const next = await getPage(page)
    runs.push(...next)
    if (runs.filter(run => run.status === 'completed').length >= threshold || next.length < 100)
      return runs.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
  }
  throw new Error('Cannot inspect enough completed workflow runs')
}

const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_REF_NAME, GITHUB_RUN_ID } =
  process.env

const api = async path => {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) throw new Error(`GitHub API returned ${response.status} for ${path}`)
  return response.json()
}

const runsFor = workflow =>
  loadRunHistory(async page => {
    const { workflow_runs: runs } = await api(
      `actions/workflows/${workflow}/runs?per_page=100&page=${page}&branch=${encodeURIComponent(GITHUB_REF_NAME)}`
    )
    return runs
  })

const jobsFor = async (id, attempt) => {
  const { jobs, total_count: count } = await api(`actions/runs/${id}/attempts/${attempt}/jobs?per_page=100`)
  if (!jobs.length || count > jobs.length) throw new Error(`Cannot inspect all jobs for run ${id}`)
  return jobs
}

/**
 * Finds the alert keys reported by the last monitor job that finished before this run.
 */
const reportedKeys = async () => {
  const { workflow_runs: runs } = await api(
    `actions/workflows/${monitorWorkflow}/runs?per_page=20&branch=${encodeURIComponent(GITHUB_REF_NAME)}`
  )
  for (const run of runs) {
    if (String(run.id) === GITHUB_RUN_ID || run.status !== 'completed') continue
    const job = (await jobsFor(run.id, run.run_attempt)).find(({ name }) => name === monitorJob)
    if (!['success', 'failure'].includes(job?.conclusion)) continue
    return alertKeys(await api(`check-runs/${job.id}/annotations?per_page=100`))
  }
  return new Set()
}

const main = async () => {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !GITHUB_EVENT_PATH || !GITHUB_REF_NAME || !GITHUB_RUN_ID)
    throw new Error('Missing GitHub event credentials')

  if (GITHUB_EVENT_NAME === 'workflow_run') {
    const { workflow_run: event } = JSON.parse(await readFile(GITHUB_EVENT_PATH, 'utf8'))
    if (event.head_branch !== GITHUB_REF_NAME) return
  }

  const problems = []
  for (const workflow of workflows) {
    const problem = await checkWorkflow(workflow, await runsFor(workflow), jobsFor)
    if (problem) problems.push(problem)
  }

  const reported = await reportedKeys()
  for (const line of annotate(problems, reported)) console.log(line)
  if (problems.some(({ key }) => !reported.has(key))) process.exitCode = 1
}

if (process.argv[1]?.endsWith('monitor.mjs')) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
