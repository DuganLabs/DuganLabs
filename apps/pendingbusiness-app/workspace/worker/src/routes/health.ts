export function health(): Response {
  return Response.json({
    ok: true,
    service: 'pending-business',
    timestamp: Date.now(),
  });
}
