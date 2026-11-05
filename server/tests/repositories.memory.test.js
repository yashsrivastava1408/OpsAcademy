const { createMemoryRepos } = require('../repositories/memory');
const { runContract } = require('./contract/repositories.contract');

runContract('memory', async () => createMemoryRepos());
