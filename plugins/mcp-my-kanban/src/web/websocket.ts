import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';

const WEB_PORT = parseInt(process.env.WEB_PORT ?? '34567', 10);

let wss: WebSocketServer | null = null;

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    ws.on('error', console.error);
  });
}

export function broadcast(type: string, payload: unknown): void {
  if (wss) {
    const message = JSON.stringify({ type, payload });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
    return;
  }
  // HTTP relay to the WebSocket owner instance
  const body = JSON.stringify({ type, payload });
  const req = http.request(
    {
      hostname: '127.0.0.1',
      port: WEB_PORT,
      path: '/api/_broadcast',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 2000,
    },
    () => {},
  );
  req.on('error', () => {});
  req.end(body);
}
