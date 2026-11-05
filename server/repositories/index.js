/**
 * The repositories for this process: Postgres when DATABASE_URL is set (always
 * in production), otherwise in memory. Tests get a fresh in-memory set.
 */

const { createMemoryRepos } = require('./memory');
const { RepoError } = require('./errors');

let current = null;

function createRepos(config) {
  if (config.databaseUrl && !config.isTest) {
    const { createPostgresRepos } = require('./postgres');
    const local = /localhost|127\.0\.0\.1/.test(config.databaseUrl);
    const ssl = local ? false : config.databaseCa ? { ca: config.databaseCa } : { rejectUnauthorized: false };
    return createPostgresRepos({ connectionString: config.databaseUrl, max: config.databasePoolSize, ssl });
  }
  return createMemoryRepos();
}

function getRepos() {
  if (!current) current = createRepos(require('../config'));
  return current;
}

/** Replace the repositories (tests). */
function setRepos(repos) {
  current = repos;
  return repos;
}

module.exports = { getRepos, setRepos, createRepos, createMemoryRepos, RepoError };
