import { AutoRouter, cors } from 'itty-router';

const { preflight, corsify } = cors({ origin: '*' });

const router = AutoRouter({
  before: [preflight],
  finally: [corsify],
});

router.get('/api/health', () => ({ status: 'ok', service: 'duganlabs' }));

export default {
  fetch: (request, env, ctx) => router.fetch(request, env, ctx),
};
