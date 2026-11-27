/**
 * The way into a conversation from the record it is about (GP-055).
 *
 * A chat room needs a subject — a customer, a job — or it is an inbox with
 * no context. The Message action on a detail route asks the API for the
 * room already attached to that record and opens it; only when there is
 * none does it create one, named after the record ("Alex Rivera", "#1001
 * 200A Panel Upgrade"). The API dedupes on the same key, so two teammates
 * pressing Message at once still land in one room; the lookup here is what
 * keeps the common case to a single read.
 */

import type { ChatRoom } from '@greenput/shared/models';
import type { PlatformDeps } from '../../deps.js';
import { el, on, type Cleanup } from '../../lib/dom.js';

export type ConversationEntityType = 'customer' | 'job';

export interface ConversationSubject {
  readonly entityType: ConversationEntityType;
  readonly entityId: string;
  /** What the room is called when it has to be created. */
  readonly name: string;
}

/** The room about `subject`, found or made. */
export async function findOrCreateRoom(
  deps: Pick<PlatformDeps, 'chat'>,
  subject: ConversationSubject,
): Promise<ChatRoom> {
  const { entityType, entityId, name } = subject;
  const existing = await deps.chat.listRooms({ entityType, entityId });
  const room = existing.data?.[0];
  if (room) return room;
  const created = await deps.chat.createRoom({ name, entityType, entityId });
  return created.data;
}

export interface MessageActionOptions {
  readonly deps: PlatformDeps;
  readonly subject: ConversationSubject;
  readonly testId: string;
  /** Where a failure is said — the detail frame's status line. */
  readonly onError: (message: string) => void;
}

export interface MessageAction {
  readonly element: HTMLElement;
  dispose(): void;
}

/** A "Message" button that opens the record's conversation at `/chat/:id`. */
export function messageAction(options: MessageActionOptions): MessageAction {
  const { deps, subject, testId, onError } = options;
  const button = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'secondary',
      'data-testid': testId,
    },
    'Message',
  );
  let busy = false;

  async function open(): Promise<void> {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      const room = await findOrCreateRoom(deps, subject);
      void deps.router.navigate(`/chat/${room.id}`);
    } catch (err) {
      onError(
        err instanceof Error
          ? `Could not open the conversation: ${err.message}`
          : 'Could not open the conversation.',
      );
    } finally {
      busy = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }

  const off: Cleanup = on(button, 'click', () => {
    void open();
  });

  return { element: button, dispose: off };
}
