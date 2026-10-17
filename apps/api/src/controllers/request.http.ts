import type { RequestHandler } from 'express';

export const requireJson: RequestHandler = (req, res, next) => {
    if (!req.is('application/json')) {
        res.status(415).json({
            type: 'invalid_request',
            message: 'Content-Type must be application/json',
        });
        return;
    }
    next();
};
