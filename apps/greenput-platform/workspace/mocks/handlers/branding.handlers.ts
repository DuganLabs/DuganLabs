import { http, HttpResponse } from 'msw';
import { createBranding } from '../data/branding.fixtures';

export const getBrandingSuccess = http.get('*/api/branding', async () => {
  return HttpResponse.json({ data: createBranding() });
});

export const updateBrandingSuccess = http.patch('*/api/branding', async () => {
  return HttpResponse.json({ data: createBranding() });
});

export const brandingHandlers = [getBrandingSuccess, updateBrandingSuccess];
