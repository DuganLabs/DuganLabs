/**
 * `/chat` — Messages: every conversation in the workspace (GP-055).
 *
 * The list the crew opens to see who has said something. Each row is a
 * room, linked to `/chat/:id`, with the count of messages the signed-in
 * user has not read (`GET /api/chat/unread`) beside it. A room is usually
 * about something — the customer or job it was started from — and the row
 * says which; "New conversation" starts one that is not, for the crew
 * itself.
 *
 * Rooms come from `GET /api/chat/rooms`, the unread counts from the
 * per-user aggregate, and the two are joined here by room id. The chat
 * itself is `chat.ts`, one room at a time.
 */

import { computed, effect, signal } from '@basenative/runtime';
import { createResource } from '@basenative/fetch';
import type {
  ApiResponse,
  ChatRoom,
  ChatUnread,
} from '@greenput/shared/models';
import type { PlatformDeps } from '../../deps.js';
import { adoptSheet, defineSheet } from '../../styles/sheet.js';
import { LIST_ROUTE_SHEET } from '../../styles/list-route.js';
import { clear, el, on, type Cleanup } from '../../lib/dom.js';
import { formatRelativeTime } from '../../lib/format.js';
import { buildPanel } from '../shared/panel.js';
import { field as formField } from '../shared/field.js';
import {
  fill,
  mountTable,
  timeCell,
  twoLines,
  type TableColumn,
} from '../shared/table.js';
import type { RouteView } from '../types.js';

const CHAT_LIST_SHEET = defineSheet(`
[data-bn-unread] {
  display: inline-flex;
  align-items: center;
  min-inline-size: 1.5rem;
  padding: 2px var(--gp-space-2);
  border-radius: var(--gp-radius-full);
  background: var(--gp-primary);
  color: var(--gp-primary-fg);
  font-size: var(--gp-text-xs);
  font-weight: var(--gp-weight-bold);
  justify-content: center;
}
`);

/** "About a customer" / "About a job" — what the row was started from. */
export function subjectLabel(room: Pick<ChatRoom, 'entityType'>): string {
  switch (room.entityType) {
    case 'customer':
      return 'About a customer';
    case 'job':
      return 'About a job';
    default:
      return 'The crew';
  }
}

export function renderChatListRoute(deps: PlatformDeps): RouteView {
  adoptSheet(LIST_ROUTE_SHEET);
  adoptSheet(CHAT_LIST_SHEET);

  const cleanups: Cleanup[] = [];
  const showPanel = signal(false);
  const name = signal('');
  const submitting = signal(false);
  const submitError = signal<string | null>(null);

  const rooms = createResource<ApiResponse<ChatRoom[]>>(
    () => deps.chat.listRooms(),
    { auto: true },
  );
  const unread = createResource<{ data: ChatUnread[] }>(
    () => deps.chat.unread(),
    { auto: true },
  );
  const unreadByRoom = computed<ReadonlyMap<string, number>>(
    () =>
      new Map(
        (unread.data()?.data ?? []).map((u) => [u.roomId, u.unreadCount]),
      ),
  );

  // ── header ─────────────────────────────────────────────────────────────
  const newButton = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'chat-list-new',
    },
    'New conversation',
  );
  cleanups.push(
    on(newButton, 'click', () => {
      name.set('');
      submitError.set(null);
      showPanel.set(true);
    }),
  );
  const header = el(
    'header',
    {},
    el(
      'div',
      {},
      el('h1', {}, 'Messages'),
      el(
        'p',
        {},
        'Conversations with your crew. Start one from a customer or a job, or here.',
      ),
    ),
    newButton,
  );

  // ── create panel ───────────────────────────────────────────────────────
  const nameInput = el('input', {
    type: 'text',
    'data-bn-input': '',
    'data-testid': 'chat-list-form-name',
    autocomplete: 'off',
    placeholder: 'What is it about?',
  }) as HTMLInputElement;
  cleanups.push(
    on(nameInput, 'input', () => {
      name.set(nameInput.value);
      nameInput.removeAttribute('aria-invalid');
    }),
  );
  const panel = buildPanel({
    title: 'New conversation',
    body: [formField('Name', nameInput)],
    submitting,
    submitError,
    submitLabel: 'Start conversation',
    syncForm: () => {
      nameInput.value = name.peek();
    },
    onSubmit: async () => {
      const value = name.peek().trim();
      if (!value) {
        submitError.set('Give the conversation a name.');
        nameInput.setAttribute('aria-invalid', 'true');
        nameInput.focus();
        return;
      }
      submitting.set(true);
      submitError.set(null);
      try {
        const { data } = await deps.chat.createRoom({ name: value });
        showPanel.set(false);
        void deps.router.navigate(`/chat/${data.id}`);
      } catch (err) {
        submitError.set(
          err instanceof Error
            ? err.message
            : 'Could not start the conversation.',
        );
      } finally {
        submitting.set(false);
      }
    },
    onCancel: () => showPanel.set(false),
  });
  cleanups.push(panel.dispose);

  // ── content slots ──────────────────────────────────────────────────────
  const tableWrap = el('div', {
    'data-bn-table-wrap': '',
    'data-testid': 'chat-list-rooms',
  });
  const empty = el(
    'p',
    { 'data-bn-empty': '', hidden: true, 'data-testid': 'chat-list-empty' },
    'No conversations yet. Open a customer or a job and press Message, or start one here.',
  );
  const errorNode = el('p', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
    'data-testid': 'chat-list-error',
  });
  const loadingNode = el(
    'p',
    { 'data-bn-loading': '', role: 'status', hidden: true },
    'Loading conversations…',
  );

  const columns: readonly TableColumn<ChatRoom>[] = [
    {
      key: 'conversation',
      label: 'Conversation',
      value: (room) => room.name,
      href: (room) => `/chat/${room.id}`,
      cell: (room, td) => fill(td, ...twoLines(room.name, subjectLabel(room))),
    },
    {
      key: 'unread',
      label: 'Unread',
      value: (room) => {
        const n = unreadByRoom().get(room.id) ?? 0;
        return n > 0 ? `${n} new` : '';
      },
      cell: (room, td) => {
        const n = unreadByRoom().get(room.id) ?? 0;
        fill(td, n > 0 ? el('span', { 'data-bn-unread': '' }, `${n} new`) : '');
      },
    },
    {
      key: 'started',
      label: 'Started',
      value: (room) => formatRelativeTime(room.createdAt),
      cell: (room, td) =>
        fill(td, timeCell(room.createdAt, formatRelativeTime(room.createdAt))),
    },
  ];

  const content = el('div', { 'data-bn-list-content': '' });
  const root = el(
    'section',
    { 'data-bn-list-route': '', 'data-bn-route': 'chat-list' },
    header,
    content,
  );

  cleanups.push(
    effect(() => {
      const open = showPanel();
      clear(content);
      if (open) {
        content.append(panel.element);
        nameInput.focus();
      } else {
        content.append(loadingNode, errorNode, empty, tableWrap);
      }
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const list = rooms.data()?.data ?? [];
      const isLoading = rooms.loading();
      const err = rooms.error();
      // Read so a late unread answer re-renders the counts.
      unreadByRoom();

      toggle(loadingNode, isLoading && list.length === 0);
      toggle(errorNode, err !== null);
      if (err)
        errorNode.textContent = `Could not load conversations: ${err.message}`;

      const hasData = list.length > 0;
      toggle(empty, !isLoading && err === null && !hasData);
      toggle(tableWrap, hasData);
      mountTable(tableWrap, { columns, rows: list, caption: 'Conversations' });
    }).dispose,
  );

  return {
    element: root,
    dispose: () => {
      rooms.dispose();
      unread.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

function toggle(node: HTMLElement, visible: boolean): void {
  if (visible) node.removeAttribute('hidden');
  else node.setAttribute('hidden', '');
}
