// Entrada da API na Vercel. O vercel.json manda /api/* para cá.
import { handle } from 'hono/vercel';
import { app } from '../server/app.js';

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
