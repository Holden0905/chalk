const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let pass = 0;
const t = (name, fn) => { fn(); console.log(`  ok  ${name}`); pass++; };

const ROOT = path.join(__dirname, '..');
const RUNNER = path.join(ROOT, 'docker', 'run-job.sh');
const CRONTAB = path.join(ROOT, 'docker', 'crontab');

// A throwaway npm project, so a test never runs a real ingest script or touches
// the network. The runner is pointed at it with CHALK_APP_DIR.
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chalk-runjob-'));
  fs.mkdirSync(path.join(dir, 'app'));
  fs.writeFileSync(
    path.join(dir, 'app', 'package.json'),
    JSON.stringify({
      name: 'fixture', version: '1.0.0', private: true,
      scripts: {
        ok: 'echo did the thing',
        odds: "echo 'x-requests-remaining: 417'",
        boom: 'exit 3',
      },
    }),
  );
  return dir;
}

/** Run the runner the way cron or a person would, and report what came back. */
function run(args, { dir, dryRun = false } = {}) {
  const home = dir ?? sandbox();
  const res = spawnSync(RUNNER, args, {
    env: {
      ...process.env,
      CHALK_APP_DIR: path.join(home, 'app'),
      CHALK_LOG_DIR: path.join(home, 'logs'),
      CHALK_ENV_FILE: path.join(home, 'none.env'),
      ...(dryRun ? { CHALK_DRY_RUN: '1' } : {}),
    },
    encoding: 'utf8',
  });
  const beatPath = path.join(home, 'logs', 'heartbeat', args[0] ?? '');
  const logPath = path.join(home, 'logs', `${args[0] ?? ''}.log`);
  return {
    code: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    dir: home,
    beat: fs.existsSync(beatPath) ? fs.readFileSync(beatPath, 'utf8') : null,
    log: fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : null,
  };
}

const field = (beat, key) => {
  const m = (beat ?? '').match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1] : null;
};

// --- the bug this file exists for -------------------------------------------
// A job name with no scripts after it used to shift off the only argument, loop
// over an empty list and report a clean run having done nothing. Cron passed
// both the name and the scripts so it never showed up there; a person testing by
// hand typed the name alone and got a silent no-op.
t('a job with no resolvable scripts exits non-zero', () => {
  const r = run(['not-a-job']);
  assert.notEqual(r.code, 0, 'nothing to run must not look like a clean run');
  assert.equal(r.code, 2);
});

t('the failure is recorded in the heartbeat, not just on the terminal', () => {
  const r = run(['not-a-job']);
  assert.equal(field(r.beat, 'exit'), '2');
  assert.equal(field(r.beat, 'scripts'), '');
  assert.match(r.log, /no scripts for job not-a-job/);
  assert.match(r.log, /Known jobs:/);
});

t('no arguments at all is a usage error', () => {
  const r = run([]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /usage: run-job\.sh/);
});

// --- the job name alone is enough -------------------------------------------
t('every scheduled job resolves from its name alone', () => {
  const expected = {
    snapshot: 'snapshot',
    props: 'snapshot:props',
    context: 'snapshot:context',
    grade: 'grade',
    'ingest-games': 'ingest:games',
    'ingest-pbp': 'ingest:pbp ingest:players rate',
  };
  for (const [job, scripts] of Object.entries(expected)) {
    const r = run([job], { dryRun: true });
    assert.equal(r.code, 0, `${job} should resolve`);
    assert.equal(r.stdout.trim(), scripts, `${job} resolves to the wrong scripts`);
  }
});

t('the job name alone actually runs the scripts', () => {
  // The reported symptom: exit=0 in 0s having run nothing. Proven here by
  // checking the script's own output reached the log.
  const r = run(['fixture-ok', 'ok']);
  assert.equal(r.code, 0);
  assert.match(r.log, /did the thing/);
  assert.equal(field(r.beat, 'scripts'), 'ok');
});

t('explicit scripts still override the table', () => {
  const r = run(['snapshot', 'ok']);
  assert.equal(r.code, 0);
  assert.equal(field(r.beat, 'scripts'), 'ok');
  assert.match(r.log, /did the thing/);
});

// --- the crontab and the runner must agree ----------------------------------
t('every job the crontab schedules is one the runner knows', () => {
  // This is the drift the original bug was made of: the schedule said one thing
  // about how to invoke a job and the runner expected another.
  const lines = fs.readFileSync(CRONTAB, 'utf8').split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !/^[A-Z_]+=/.test(l));
  assert.ok(lines.length > 0, 'the crontab should have some jobs in it');

  for (const line of lines) {
    const m = line.match(/run-job\.sh\s+(.*)$/);
    assert.ok(m, `no run-job.sh call in: ${line}`);
    const args = m[1].trim().split(/\s+/);
    assert.equal(args.length, 1, `the crontab should pass a job name only: ${line}`);
    const r = run([args[0]], { dryRun: true });
    assert.equal(r.code, 0, `crontab schedules unknown job "${args[0]}"`);
  }
});

// --- the rest of the contract, so the fix did not break it ------------------
t('a failing script gives a non-zero exit and names the step', () => {
  const r = run(['fixture-chain', 'ok', 'boom', 'ok']);
  assert.equal(r.code, 3);
  assert.equal(field(r.beat, 'exit'), '3');
  assert.equal(field(r.beat, 'failed_step'), 'boom');
  // The step after the failure must not have run.
  assert.equal((r.log.match(/did the thing/g) ?? []).length, 1);
});

t('the Odds API budget is picked out of the output', () => {
  const r = run(['fixture-odds', 'odds']);
  assert.equal(field(r.beat, 'requests_remaining'), '417');
});

t('a job that spends no API budget reads n/a rather than zero', () => {
  const r = run(['fixture-ok', 'ok']);
  assert.equal(field(r.beat, 'requests_remaining'), 'n/a');
});

t('the rolling heartbeat follows the most recent run', () => {
  const dir = sandbox();
  run(['fixture-ok', 'ok'], { dir });
  run(['fixture-odds', 'odds'], { dir });
  const rolling = fs.readFileSync(path.join(dir, 'logs', 'heartbeat.txt'), 'utf8');
  assert.equal(field(rolling, 'job'), 'fixture-odds');
});

console.log(`\n${pass} assertions passed`);
