import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
    index('./routes/landing.tsx'),
    route('conversion', './routes/conversion.tsx'),
] satisfies RouteConfig;
