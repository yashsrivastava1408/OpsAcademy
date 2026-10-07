/**
 * Checks the container hardening without needing a Docker daemon. The live
 * behaviour (limits actually enforced) is exercised by scripts/docker-check.js.
 */

const config = require('../config');
const docker = require('../services/dockerService');

const options = docker.buildContainerOptions('abc123', { labId: 'linux-basics', networkMode: 'none' });
const host = options.HostConfig;

test('runs as the unprivileged student user, never root', () => {
  expect(options.User).toBe('1000:1000');
  expect(host.Privileged).toBe(false);
});

test('drops every capability and forbids gaining new privileges', () => {
  expect(host.CapDrop).toEqual(['ALL']);
  expect(host.CapAdd).toBeUndefined();
  expect(host.SecurityOpt).toContain('no-new-privileges:true');
});

test('caps memory, swap, CPU and process count', () => {
  expect(host.Memory).toBe(config.sandbox.maxMemoryMB * 1024 * 1024);
  expect(host.MemorySwap).toBe(host.Memory);
  expect(host.NanoCpus).toBe(config.sandbox.maxCpuCores * 1e9);
  expect(host.PidsLimit).toBe(config.sandbox.maxPids);
  expect(host.PidsLimit).toBeGreaterThan(0);
});

test('root filesystem is read-only; writable space is size-capped tmpfs', () => {
  expect(host.ReadonlyRootfs).toBe(true);
  expect(host.Tmpfs['/home/student']).toMatch(new RegExp(`size=${config.sandbox.homeSizeMB}m`));
  expect(host.Tmpfs['/home/student']).toMatch(/nosuid/);
  expect(host.Tmpfs['/home/student']).toMatch(/\bexec\b/); // lab scripts must be runnable
  expect(host.Tmpfs['/tmp']).toMatch(/noexec/);
  expect(host.Binds).toBeUndefined();
  expect(host.Mounts).toBeUndefined();
});

test('has no network by default and never mounts the Docker socket', () => {
  expect(host.NetworkMode).toBe('none');
  expect(config.sandbox.dockerNetworkMode).toBe('none');
  expect(JSON.stringify(options)).not.toContain('docker.sock');
});

test('is labelled so orphans can be found and removed after a crash', () => {
  expect(options.Labels).toEqual({ 'opsacademy.sandbox': 'abc123' });
  expect(options.name).toBe('opsacademy-sbx-abc123');
});
