'use strict';

require('dotenv').config();

const loadConfig = require('../src/config/loadConfig');

const config = loadConfig();

console.log(JSON.stringify({
  nodeEnv: config.nodeEnv,
  port: config.port,
  serverType: config.serverType,
  mainServerUrl: config.mainServerUrl,
  localFactoryId: config.localFactoryId,
  db: {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    database: config.db.database
  },
  localServer: {
    agentEnabled: config.localServer.agentEnabled,
    nodeId: config.localServer.nodeId
  }
}, null, 2));
