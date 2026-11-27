import { http, HttpResponse } from 'msw';
import {
  createWorkspace,
  createWorkspaceUser,
  createWorkspaceUserList,
} from '../data/workspace.fixtures';

// ── Success handlers ────────────────────────────────────────

export const getWorkspaceSuccess = http.get('*/api/workspace', async () => {
  return HttpResponse.json({
    data: {
      workspace: createWorkspace(),
      users: createWorkspaceUserList(3),
    },
  });
});

export const updateWorkspaceSuccess = http.patch(
  '*/api/workspace',
  async () => {
    return HttpResponse.json({
      data: createWorkspace({ name: 'Updated Electric' }),
    });
  },
);

export const inviteWorkspaceUserSuccess = http.post(
  '*/api/workspace/users',
  async () => {
    return HttpResponse.json(
      { data: createWorkspaceUser({ role: 'office' }) },
      { status: 201 },
    );
  },
);

export const updateWorkspaceUserSuccess = http.patch(
  '*/api/workspace/users/:id',
  async ({ params }) => {
    return HttpResponse.json({
      data: createWorkspaceUser({ id: params['id'] as string, role: 'admin' }),
    });
  },
);

export const deleteWorkspaceUserSuccess = http.delete(
  '*/api/workspace/users/:id',
  async () => {
    return HttpResponse.json({ data: { deleted: true } });
  },
);

// ── Error handlers ──────────────────────────────────────────

export const getWorkspaceError500 = http.get('*/api/workspace', async () => {
  return HttpResponse.json(
    { message: 'Internal server error' },
    { status: 500 },
  );
});

// ── Default export ──────────────────────────────────────────

export const workspaceHandlers = [
  getWorkspaceSuccess,
  updateWorkspaceSuccess,
  inviteWorkspaceUserSuccess,
  updateWorkspaceUserSuccess,
  deleteWorkspaceUserSuccess,
];
