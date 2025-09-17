import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
    index('./routes/landing/index.tsx'),
    route('conversion', './routes/conversion/index.tsx'),
] satisfies RouteConfig;
