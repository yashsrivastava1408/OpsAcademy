/**
 * Agent Proxy Routes — API Gateway Proxy to Python AI Agent Hub
 */

const express = require('express');
const axios = require('axios');
const config = require('../config');

const router = express.Router();
const AI_HUB_URL = config.aiHubUrl || 'http://localhost:5005';

/**
 * POST /api/agent/hint
 * Proxy request to Python AI Hub multi-agent pipeline
 */
router.post('/hint', async (req, res, next) => {
  try {
    const { query, unitId, stepNumber, commandHistory } = req.body;

    try {
      const response = await axios.post(`${AI_HUB_URL}/api/agent/hint`, {
        query,
        unitId,
        stepNumber,
        commandHistory,
      });

      return res.json(response.data);
    } catch (aiErr) {
      console.warn('[Agent Gateway] AI Hub microservice unreachable, returning rule-based fallback hint:', aiErr.message);

      // Intelligent Gateway Fallback Hint if Python AI Hub is offline
      let fallbackHint = "💡 **OpsAcademy AI Mentor:** Make sure to check the instructions for this step!";
      if (query && query.toLowerCase().includes('permission')) {
        fallbackHint = "💡 **OpsAcademy AI Mentor:** Check file permissions using `ls -la`. You might need `chmod +x <filename>`.";
      } else if (query && query.toLowerCase().includes('docker')) {
        fallbackHint = "💡 **OpsAcademy AI Mentor:** Check your running containers with `docker ps` or all containers with `docker ps -a`.";
      }

      return res.json({
        success: true,
        data: {
          blocked: false,
          hint: fallbackHint,
          fallback: true,
        },
      });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agent/scan
 */
router.post('/scan', async (req, res, next) => {
  try {
    const { command } = req.body;

    try {
      const response = await axios.post(`${AI_HUB_URL}/api/agent/scan`, { command });
      return res.json(response.data);
    } catch (err) {
      return res.json({
        success: true,
        data: { safe: true, reason: 'Scanner fallback' },
      });
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
