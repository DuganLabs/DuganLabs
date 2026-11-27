import { setupServer } from 'msw/node';
import { setupPactMswAdapter } from '@pactflow/pact-msw-adapter';
import { handlers } from '../../mocks/handlers';

export function createPactServer(): {
  server: ReturnType<typeof setupServer>;
  pactAdapter: ReturnType<typeof setupPactMswAdapter>;
} {
  const server = setupServer(...handlers);
  const pactAdapter = setupPactMswAdapter({
    server,
    options: {
      consumer: 'greenput-frontend',
      providers: {
        'greenput-api': {
          providerName: 'greenput-api',
          filters: ['api'],
        },
      },
      pactOutDir: './contracts/pacts',
    },
  });

  return { server, pactAdapter };
}
