import { Router } from 'express';
import { createSession } from '../controllers/sessions.controller';
import rateLimit from 'express-rate-limit';

const sessionsRouter = Router();

// Stricter limiter only for POST /sessions - 3 sessions / minute
// TODO: Configurable? What about for unit testing?
const sessionLimiter = rateLimit({
    windowMs: 60_000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
});

// POST /sessions
sessionsRouter.post('/', sessionLimiter, createSession);

export default sessionsRouter;
