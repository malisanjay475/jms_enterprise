'use strict';

const express = require('express');
const compression = require('compression');
const cors = require('cors');

function registerCoreMiddleware(app) {
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: false, limit: '50mb' }));
  app.use(compression({
    filter: (req, res) => {
      if (req.path.includes('/api/assembly/events')) return false;
      return compression.filter(req, res);
    }
  }));
}

module.exports = registerCoreMiddleware;
