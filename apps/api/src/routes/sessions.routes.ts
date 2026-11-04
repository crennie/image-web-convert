import { Router } from 'express';
import { createSession } from '../controllers/sessions.controller';
import rateLimit from 'express-rate-limit';
import { loadEnv } from '../env';

export default function createSessionsRouter(): Router {
    const router = Router();
    const env = loadEnv();
    const sessionLimiter = rateLimit({
        windowMs: env.RATE_LIMIT_WINDOW_MS,
        max: env.SESSION_RATE_LIMIT_MAX,
        standardHeaders: true,
        legacyHeaders: false,
    });
    router.post('/', sessionLimiter, createSession);
    return router;
}
