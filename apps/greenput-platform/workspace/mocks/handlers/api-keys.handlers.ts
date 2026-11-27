import { http, HttpResponse } from 'msw';
import { createApiKey, createApiKeyList } from '../data/api-keys.fixtures';

export const getApiKeysSuccess = http.get('*/api/api-keys', async () => {
  return HttpResponse.json({ data: createApiKeyList(2) });
});

export const createApiKeySuccess = http.post('*/api/api-keys', async () => {
  const key = createApiKey({ name: 'New Key' });
  return HttpResponse.json(
    { data: { ...key, rawKey: `gp_rawsecret${Date.now()}` } },
    { status: 201 },
  );
});

export const deleteApiKeySuccess = http.delete(
  '*/api/api-keys/:id',
  async () => {
    return HttpResponse.json({ data: { deleted: true } });
  },
);

export const apiKeysHandlers = [
  getApiKeysSuccess,
  createApiKeySuccess,
  deleteApiKeySuccess,
];
