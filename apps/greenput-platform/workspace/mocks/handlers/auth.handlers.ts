import { http, HttpResponse, delay } from 'msw';

// ── Success handlers ────────────────────────────────────────

export const loginSuccess = http.post('*/api/auth/login', async () => {
  return HttpResponse.json({
    data: {
      user: {
        id: 'user-1',
        email: 'admin@greenput.com',
        firstName: 'Admin',
        lastName: 'User',
        role: 'owner',
        workspaceId: 'ws-1',
      },
    },
  });
});

export const logoutSuccess = http.post('*/api/auth/logout', async () => {
  return HttpResponse.json({ data: { ok: true } });
});

export const meSuccess = http.get('*/api/auth/me', async () => {
  return HttpResponse.json({
    data: {
      user: {
        id: 'user-1',
        email: 'admin@greenput.com',
        firstName: 'Admin',
        lastName: 'User',
        role: 'owner',
        workspaceId: 'ws-1',
      },
    },
  });
});

// ── Error handlers ──────────────────────────────────────────

export const loginUnauthorized = http.post('*/api/auth/login', async () => {
  return HttpResponse.json({ message: 'Invalid credentials' }, { status: 401 });
});

export const meUnauthorized = http.get('*/api/auth/me', async () => {
  return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
});

// ── Server Error handlers ───────────────────────────────────

export const loginError500 = http.post('*/api/auth/login', async () => {
  return HttpResponse.json(
    { message: 'Internal server error' },
    { status: 500 },
  );
});

// ── Slow handlers ───────────────────────────────────────────

export const loginSlow = http.post('*/api/auth/login', async () => {
  await delay(2000);
  return HttpResponse.json({
    data: {
      user: {
        id: 'user-1',
        email: 'admin@greenput.com',
        firstName: 'Admin',
        lastName: 'User',
        role: 'owner',
        workspaceId: 'ws-1',
      },
    },
  });
});

// ── Default export ──────────────────────────────────────────

export const authHandlers = [loginSuccess, logoutSuccess, meSuccess];
