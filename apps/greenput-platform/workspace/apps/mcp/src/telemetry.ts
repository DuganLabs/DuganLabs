import { appendFileSync } from 'node:fs';

/**
 * Telemetry — first-party invocation data.
 *
 * Every tool call appends one record: which tool, which client, the SHAPE
 * of the query, and whether it came back empty. Query shape is deliberately
 * not the query: no customer names, no contact details, no free text that
 * could carry PII. For find_contractors the zero-result rate is the content
 * backlog — every zero is a coverage gap or a page to build — which is why
 * zero_result is a first-class field and not derivable noise.
 */
export interface TelemetryRecord {
  tool: 'find_contractors' | 'start_quote' | 'request_booking';
  /** Sanitized MCP client name from the initialize handshake. */
  client: string;
  /** Privacy-safe summary of the call's shape — never raw personal data. */
  query_shape: Record<string, unknown>;
  zero_result: boolean;
  at: string;
}

export class TelemetrySink {
  readonly records: TelemetryRecord[] = [];

  constructor(private readonly filePath?: string) {}

  record(entry: Omit<TelemetryRecord, 'at'>): void {
    const full: TelemetryRecord = {
      ...entry,
      at: new Date().toISOString(),
    };
    this.records.push(full);
    if (this.filePath) {
      appendFileSync(this.filePath, `${JSON.stringify(full)}\n`, 'utf8');
    }
  }
}
