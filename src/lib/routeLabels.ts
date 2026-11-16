import type { Route } from '../types';

/**
 * Labels for the fallback route path. A route is called "cleanest" only when every route was scored by the model;
 * with any heuristic-only route the labels stay as planned and the card says "rough estimate".
 */
export function relabelScoredRoutes(routes: Route[]): Route[] {
  if (routes.length < 2 || !routes.every((r) => r.aqi_estimate === 'model')) return routes;
  const fastest = [...routes].sort((a, b) => a.duration_seconds - b.duration_seconds)[0];
  const cleanest = [...routes].filter((r) => r !== fastest).sort((a, b) => a.avg_aqi - b.avg_aqi)[0];
  return routes.map((r) => ({ ...r, route_type: r === fastest ? 'fast' : r === cleanest ? 'eco' : 'balanced' }));
}
