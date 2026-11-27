import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound } from '../lib/response';
import { acceptLeadOffer, declineLeadOffer, offerLead } from '../lib/pool';
import {
  CARD_REQUIRED_MESSAGE,
  DELIVERY_PAUSED_MESSAGE,
} from '../lib/lead-billing-gate';

export const poolRouter = Router({ base: '/api/pool' });

// GET /api/pool/offers?direction=incoming|outgoing — offers touching my
// workspace. Incoming rows carry the lead's service + the origin
// workspace's name: the minimum a receiver needs to decide.
poolRouter.get('/offers', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId as string;
  const url = new URL(req.url);
  const direction = url.searchParams.get('direction') ?? 'incoming';
  const column =
    direction === 'outgoing' ? 'o.from_workspace_id' : 'o.to_workspace_id';
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.lead_id, o.consumer_id, o.from_workspace_id,
            o.to_workspace_id, o.status, o.offered_at, o.responded_at,
            l.service_type, l.first_name, l.last_name,
            fw.name AS from_name, tw.name AS to_name
     FROM lead_offers o
     JOIN leads l ON l.id = o.lead_id
     JOIN workspaces fw ON fw.id = o.from_workspace_id
     JOIN workspaces tw ON tw.id = o.to_workspace_id
     WHERE ${column} = ?
     ORDER BY o.offered_at DESC LIMIT 100`,
  )
    .bind(workspaceId)
    .all();
  return json({ data: results ?? [] });
});

// POST /api/pool/offers { leadId, toWorkspaceId } — offer one of my
// leads to another workspace. Requires the consumer's reroute consent
// (403 NO_REROUTE_CONSENT otherwise): a lead is not GreenPut's to move.
poolRouter.post('/offers', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId as string;
  let body: { leadId?: unknown; toWorkspaceId?: unknown };
  try {
    body = (await (req as unknown as Request).json()) as typeof body;
  } catch {
    return error('Request body must be JSON.', 400, 'INVALID_BODY');
  }
  const leadId = typeof body.leadId === 'string' ? body.leadId : '';
  const toWorkspaceId =
    typeof body.toWorkspaceId === 'string' ? body.toWorkspaceId : '';
  if (!leadId || !toWorkspaceId) {
    return error(
      'leadId and toWorkspaceId are required.',
      400,
      'VALIDATION_ERROR',
    );
  }

  const result = await offerLead(env, {
    leadId,
    fromWorkspaceId: workspaceId,
    toWorkspaceId,
  });
  if (!result.ok) {
    switch (result.reason) {
      case 'LEAD_NOT_FOUND':
        return notFound('Lead');
      case 'TARGET_NOT_FOUND':
        return error('Target workspace not found.', 404, 'TARGET_NOT_FOUND');
      case 'TARGET_IS_SELF':
        return error(
          'A lead cannot be offered to its own workspace.',
          400,
          'TARGET_IS_SELF',
        );
      case 'LEAD_ACCEPTED':
        return error(
          'An accepted lead cannot be offered.',
          409,
          'LEAD_ACCEPTED',
        );
      case 'LEAD_WITHDRAWN':
        return error(
          'A withdrawn lead cannot be offered.',
          409,
          'LEAD_WITHDRAWN',
        );
      case 'ALREADY_OFFERED':
        return error(
          'This lead already has an open offer.',
          409,
          'ALREADY_OFFERED',
        );
      case 'NO_REROUTE_CONSENT':
        return error(
          'The consumer has not consented to network rerouting for this lead.',
          403,
          'NO_REROUTE_CONSENT',
        );
    }
  }
  return json(
    { data: { offerId: result.offerId, consumerId: result.consumerId } },
    201,
  );
});

// POST /api/pool/offers/:id/accept — the receiver accepts: the lead
// moves to my workspace. No fee bills here (WS-1) — the fee fires when
// the lead books into my schedule; priceUsd/vertical quote that rate.
poolRouter.post('/offers/:id/accept', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId as string;
  const result = await acceptLeadOffer(env, {
    offerId: req.params!['id']!,
    toWorkspaceId: workspaceId,
  });
  if (!result.ok) {
    switch (result.reason) {
      case 'OFFER_NOT_FOUND':
        return notFound('Offer');
      case 'OFFER_NOT_OPEN':
        return error('This offer is no longer open.', 409, 'OFFER_NOT_OPEN');
      case 'LEAD_GONE':
        return error(
          'The lead is no longer available to move.',
          409,
          'LEAD_GONE',
        );
      case 'UNMAPPED_SERVICE':
        return error(
          "The lead's service has no per-lead rate in the rate card.",
          422,
          'UNMAPPED_SERVICE',
        );
      case 'CARD_REQUIRED':
        return error(CARD_REQUIRED_MESSAGE, 409, 'CARD_REQUIRED');
      case 'DELIVERY_PAUSED':
        return error(DELIVERY_PAUSED_MESSAGE, 409, 'DELIVERY_PAUSED');
    }
  }
  return json({
    data: {
      leadId: result.leadId,
      priceUsd: result.priceUsd,
      vertical: result.vertical,
    },
  });
});

// POST /api/pool/offers/:id/decline — the receiver passes; the lead
// stays with the originator, unbilled and unmoved.
poolRouter.post('/offers/:id/decline', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId as string;
  const result = await declineLeadOffer(env, {
    offerId: req.params!['id']!,
    toWorkspaceId: workspaceId,
  });
  if (!result.ok) {
    return result.reason === 'OFFER_NOT_FOUND'
      ? notFound('Offer')
      : error('This offer is no longer open.', 409, 'OFFER_NOT_OPEN');
  }
  return json({ data: { declined: true } });
});
