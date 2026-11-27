/**
 * The Greenput pricing engine.
 *
 * An enrichment form is a finite state machine whose traversal deterministically
 * produces a price range. This library is that traversal and that arithmetic —
 * promoted out of `scripts/seed/pricing-fsms.mjs`, which now imports it, so
 * there is exactly one implementation. `seeds/pricing/fixtures/*.expected.json`
 * are its conformance oracle and `evaluate.spec.ts` runs all eighteen of them.
 *
 * Design: `docs/pricing-fsm-designs.md`. Primitives: `seeds/pricing/README.md`.
 */

export * from './types.ts';
export { rcGet, rcNum, catGet } from './rate-card.ts';
export { evalPredicate, readVarOf, rawValue } from './predicates.ts';
export { inlineFragments, resolveTerminal, edgesOf } from './graph.ts';
export { traverse, traverseGraph, questionKeys } from './traverse.ts';
export type { TraverseOptions, TraverseResult } from './traverse.ts';
export {
  evalQty,
  priceTerminal,
  computeSpread,
  bandFrom,
  roundTo,
  r2,
} from './pricing.ts';
export type { PricedTerminal, Spread, Band } from './pricing.ts';
export { evaluate, DEFAULT_ENV } from './evaluate.ts';
export {
  NOT_CONFIRMED,
  formatQuotePrice,
  QUOTE_STAGES,
  quoteStageOf,
  stageOfPriced,
} from './quote-stage.ts';
export type { QuoteStage, StageInput, StageOutcome } from './quote-stage.ts';
export { confirmWorkOrder, estimateLinesFromQuote } from './work-order.ts';
export type {
  ConfirmOutcome,
  EstimateDraft,
  EstimateDraftLine,
} from './work-order.ts';
export { validate, longestPath, referencedVars } from './validate.ts';
export type { ValidationReport } from './validate.ts';
export {
  step,
  coerceScreenAnswers,
  estimateKeyFor,
  photoStatusKeyFor,
} from './session.ts';
export type {
  Screen,
  SessionStep,
  FieldError,
  CoerceResult,
} from './session.ts';
export {
  listPublishedFlows,
  loadFlow,
  loadFlowByVersion,
  createSession,
  loadSession,
  sessionAnswers,
  sessionEnv,
  recordScreen,
  completeSession,
  attachLead,
  listSessionEvents,
  eventKind,
  foldEvents,
  previousStateId,
  undoneInputFor,
  replayAnswers,
  rewindTo,
  restartSession,
  assembleMachine,
} from './store.ts';
export { createLeadFromQuote, estimatedValueCents, qualifies } from './lead.ts';
export { withdrawLead } from './lead-withdraw.ts';
export type {
  MeterEventAdjustment,
  WithdrawLeadInput,
  WithdrawLeadOutcome,
} from './lead-withdraw.ts';
export {
  DURATION_GRANULARITY_MINUTES,
  MIN_DURATION_MINUTES,
  estimatedDurationMinutes,
} from './duration.ts';
export type { CreateLeadInput, LeadFromQuote } from './lead.ts';
export type {
  D1Like,
  D1StatementLike,
  FsmRow,
  FsmVersionRow,
  RateCardVersionRow,
  QuoteSessionRow,
  QuoteEventRow,
  QuoteEventKind,
  FoldedEvents,
  LoadedFlow,
} from './store.ts';
export { attributionUserId } from './store.ts';
export {
  ALLOWED_PHOTO_TYPES,
  AUTOMATED_CONFIDENCE_FLOOR,
  MAX_PHOTO_BYTES,
  PHOTO_STATUSES,
  PhotoError,
  UNREVIEWED,
  effectiveAnswers,
  gateReading,
  isPhotoStatus,
  listPendingReviews,
  loadPhotoReview,
  photoAnswerOf,
  readPhoto,
  recordReview,
  sanitizeFilename,
  storePanelPhoto,
  unresolvedClassifier,
  withPhotoReadings,
} from './photo.ts';
export type {
  PendingReview,
  PhotoClassifier,
  PhotoClassifierInput,
  PhotoReading,
  PhotoReviewRow,
  PhotoStatus,
  ReviewMethod,
  StoredPhoto,
  StorePhotoInput,
} from './photo.ts';
export {
  ReviewNotFoundError,
  fitsInside,
  reloadReview,
  resolvePhotoReview,
} from './review.ts';
export type { Band, ResolveInput, ResolveOutcome } from './review.ts';
export {
  PANEL_PHOTO_FLAG,
  createD1Provider,
  createFlags,
  isPanelPhotoEnabled,
  rolloutConfig,
} from './flags.ts';
export type {
  FlagConfig,
  FlagContext,
  FlagManager,
  FlagProvider,
} from './flags.ts';
