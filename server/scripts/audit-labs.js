#!/usr/bin/env node
/**
 * Audit every lab step against a real, empty sandbox.
 *
 * For each step it answers two questions:
 *   1. Does the check fail before the student has done anything? A check
 *      that passes on an empty sandbox verifies nothing.
 *   2. Are the tools the step needs installed in the sandbox? If not, the
 *      step cannot be completed there.
 *
 *   npm run labs:audit                 # Docker sandbox (needs the daemon and image)
 *   npm run labs:audit -- --mode pty   # the local shell instead
 *   npm run labs:audit -- --json       # machine-readable report
 *   npm run labs:audit -- --check      # exit 1 if any step cannot be done or passes without work (CI)
 */

const modeIndex = process.argv.indexOf('--mode');
process.env.SANDBOX_MODE = modeIndex >= 0 ? process.argv[modeIndex + 1] : 'docker';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'warn';

const units = require('../lib/units');
const { verifyStep } = require('../routes/labRoutes');
const { createManager } = require('../services/sandboxManager');

// Command-line programs a lab might call for. Only these are checked, because
// backticked text in tasks also contains file contents (nginx directives,
// Terraform keywords, YAML) whose first word is not a program.
const KNOWN_PROGRAMS = new Set(`
  ls cat cp mv rm mkdir rmdir touch ln chmod chown stat find grep egrep sed awk sort uniq wc cut tr tee xargs head tail less
  tar gzip gunzip zip unzip df du free ps top pgrep pkill sleep seq date id whoami env which man nohup crontab
  bash sh python python3 pip pip3 node npm make gcc go java
  git gh docker docker-compose podman kubectl helm kustomize minikube kind argocd terraform ansible ansible-playbook vagrant
  aws az gcloud trivy grype syft cosign hadolint checkov tfsec promtool amtool prometheus grafana-cli
  curl wget ssh scp rsync nc ncat netcat ping traceroute tracepath dig nslookup host ip ss netstat ifconfig tcpdump nmap lsof iptables
  openssl base64 sha256sum md5sum jq yq gpg vault
  systemctl journalctl service nginx redis-cli psql mysql sysctl strace falco volatility vol
`.split(/\s+/).filter(Boolean));

function programName(command) {
  for (const word of command.trim().split(/\s+/)) {
    if (word === 'sudo' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue;
    return word;
  }
  return '';
}

/** Programs a step needs: those its tasks tell the student to run, and those its check runs. */
function requiredPrograms(step) {
  const programs = new Set();
  const add = (command) => {
    const name = programName(command);
    if (KNOWN_PROGRAMS.has(name)) programs.add(name);
  };

  for (const task of step.tasks || []) {
    for (const match of task.matchAll(/`([^`]+)`/g)) {
      // `terraform { ... }` is the contents of a file to write, not a command to run.
      if (/^\s*\w+\s*\{/.test(match[1])) continue;
      add(match[1]);
    }
  }
  // Quoted arguments are data (awk programs, grep patterns), not commands.
  const unquoted = step.verification.command.replace(/'[^']*'|"[^"]*"/g, ' ');
  for (const segment of unquoted.split(/\|\||&&|[|;]/)) add(segment.replace(/^[\s(]+/, ''));
  return [...programs];
}

async function main() {
  const manager = createManager({ pool: { enabled: false }, limits: { maxPerUser: 1000, maxTotal: 1000 } });
  await manager.init();
  const mode = manager.getMode();
  const report = [];

  for (const meta of units.listMeta()) {
    // One fresh sandbox per unit; each step is checked before anything is done in it.
    const session = await manager.createSession('audit', meta.id);
    for (const step of units.getSteps(meta.id)) {
      const programs = requiredPrograms(step);
      const missing = [];
      for (const program of programs) {
        const found = await manager.exec(session.sessionId, `command -v ${program} >/dev/null 2>&1`);
        if (found.exitCode !== 0) missing.push(program);
      }
      const result = await verifyStep(manager, session.sessionId, step);
      report.push({
        unit: meta.id,
        step: step.step,
        title: step.title,
        passesWhenEmpty: result.passed,
        missingTools: missing,
      });
    }
    await manager.destroySession(session.sessionId);
  }
  await manager.shutdown();

  const trivial = report.filter((r) => r.passesWhenEmpty);
  const blocked = report.filter((r) => r.missingTools.length > 0);
  const sound = report.filter((r) => !r.passesWhenEmpty && r.missingTools.length === 0);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ mode, total: report.length, sound: sound.length, trivial: trivial.length, blocked: blocked.length, steps: report }, null, 2));
    return;
  }

  console.log(`\nLab audit in ${mode} mode: ${report.length} steps across ${units.listMeta().length} units\n`);
  console.log(`  ${String(sound.length).padStart(3)}  can be done here and have a check that fails until the work is done`);
  console.log(`  ${String(blocked.length).padStart(3)}  need a tool this sandbox does not have`);
  console.log(`  ${String(trivial.length).padStart(3)}  have a check that already passes on an empty sandbox`);

  if (blocked.length) {
    console.log('\nSteps that need a missing tool:');
    const byTool = new Map();
    for (const r of blocked) for (const tool of r.missingTools) byTool.set(tool, [...(byTool.get(tool) || []), `${r.unit}#${r.step}`]);
    for (const [tool, where] of [...byTool].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${tool.padEnd(12)} ${where.length} steps  (${where.slice(0, 4).join(', ')}${where.length > 4 ? ', ...' : ''})`);
    }
  }
  if (trivial.length) {
    console.log('\nChecks that pass before any work is done:');
    for (const r of trivial) console.log(`  ${r.unit}#${r.step}  ${r.title}`);
  }
  console.log('');

  if (process.argv.includes('--check') && (blocked.length || trivial.length)) {
    console.error(`Lab audit failed: ${blocked.length} step(s) need a missing tool, ${trivial.length} pass on an empty sandbox.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`Audit failed: ${err.message}`);
  process.exit(1);
});
