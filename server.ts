import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { MedBaySimulationEngine } from './src/server/simulationEngine.ts';
import type { ClientWsMessage, ServerWsMessage } from './src/types/medbay.ts';

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.use(express.json());

  const engine = new MedBaySimulationEngine();
  let latestSnapshot = engine.step(0.25);

  // REST endpoints for inspecting raw loaded NASA OSDR studies & health
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      studiesLoaded: Object.keys(engine.studies).length,
      terminals: latestSnapshot.terminals.length,
      seq: latestSnapshot.seq,
    });
  });

  app.get('/api/osdr-studies', (_req, res) => {
    res.json({
      count: Object.keys(engine.studies).length,
      studies: Object.values(engine.studies),
    });
  });

  app.get('/api/telemetry', (_req, res) => {
    res.json(latestSnapshot);
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  const broadcast = (message: ServerWsMessage) => {
    const payload = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  };

  wss.on('connection', (ws) => {
    const initPayload: ServerWsMessage = {
      type: 'telemetry:init',
      snapshot: latestSnapshot,
    };
    ws.send(JSON.stringify(initPayload));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientWsMessage;
        if (msg.type === 'countermeasure:toggle') {
          engine.toggleCountermeasure(msg.terminalId, msg.active);
        } else if (msg.type === 'hazard:trigger') {
          engine.triggerScenario(msg.scenario);
        } else if (msg.type === 'simulation:speed') {
          engine.setSpeed(msg.speed);
        } else if (msg.type === 'simulation:reset') {
          engine.resetToNominal();
        } else if (msg.type === 'report:generate') {
          engine.generateLiveSituationReport();
        }
        latestSnapshot = engine.step(0.05);
        broadcast({ type: 'telemetry:tick', snapshot: latestSnapshot });
      } catch (err) {
        console.error('Invalid WS message:', err);
      }
    });
  });

  // Authoritative 4Hz low-latency WebSocket simulation loop
  setInterval(() => {
    latestSnapshot = engine.step(0.25);
    if (wss.clients.size > 0) {
      broadcast({ type: 'telemetry:tick', snapshot: latestSnapshot });
    }
  }, 250);

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`ISS Medical Bay server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ISS Medical Bay server:', err);
  process.exit(1);
});
