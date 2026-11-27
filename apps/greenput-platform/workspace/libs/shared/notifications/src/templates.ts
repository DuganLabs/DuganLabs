export interface NotificationContent {
  subject: string;
  html: string;
  smsBody: string;
}

/** Alert when a new lead is created */
export function newLeadAlert(
  leadName: string,
  source: string,
): NotificationContent {
  return {
    subject: `New lead: ${leadName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px;">
        <h2 style="color: #16a34a;">New Lead Received</h2>
        <p><strong>${escapeHtml(leadName)}</strong> just came in via <em>${escapeHtml(source)}</em>.</p>
        <p>Log in to Greenput to review and follow up.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb;" />
        <p style="color: #6b7280; font-size: 12px;">Greenput CRM</p>
      </div>
    `.trim(),
    smsBody: `Greenput: New lead from ${source} - ${leadName}. Log in to follow up.`,
  };
}

/** Alert when a job status changes */
export function jobStatusChange(
  jobNumber: string,
  oldStatus: string,
  newStatus: string,
): NotificationContent {
  return {
    subject: `Job ${jobNumber} status: ${formatStatus(newStatus)}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px;">
        <h2 style="color: #16a34a;">Job Status Updated</h2>
        <p>Job <strong>${escapeHtml(jobNumber)}</strong> changed from
           <em>${escapeHtml(formatStatus(oldStatus))}</em> to
           <em>${escapeHtml(formatStatus(newStatus))}</em>.</p>
        <p>Log in to Greenput for details.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb;" />
        <p style="color: #6b7280; font-size: 12px;">Greenput CRM</p>
      </div>
    `.trim(),
    smsBody: `Greenput: Job ${jobNumber} is now ${formatStatus(newStatus)}.`,
  };
}

/** Alert when a payment is received */
export function paymentReceived(
  jobNumber: string,
  amount: number,
): NotificationContent {
  const formatted = formatCurrency(amount);
  return {
    subject: `Payment received: ${formatted} for Job ${jobNumber}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px;">
        <h2 style="color: #16a34a;">Payment Received</h2>
        <p>A payment of <strong>${escapeHtml(formatted)}</strong> has been received
           for Job <strong>${escapeHtml(jobNumber)}</strong>.</p>
        <p>Log in to Greenput for details.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb;" />
        <p style="color: #6b7280; font-size: 12px;">Greenput CRM</p>
      </div>
    `.trim(),
    smsBody: `Greenput: Payment of ${formatted} received for Job ${jobNumber}.`,
  };
}

/** Request a review from a customer after job completion */
export function reviewRequest(
  customerName: string,
  jobTitle: string,
): NotificationContent {
  return {
    subject: `How did we do? Review your ${jobTitle} service`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px;">
        <h2 style="color: #16a34a;">We'd Love Your Feedback</h2>
        <p>Hi ${escapeHtml(customerName)},</p>
        <p>Thank you for choosing us for your <strong>${escapeHtml(jobTitle)}</strong> service.
           We hope everything went well!</p>
        <p>Would you mind leaving us a quick review? It helps other homeowners
           find reliable service providers.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb;" />
        <p style="color: #6b7280; font-size: 12px;">Greenput CRM</p>
      </div>
    `.trim(),
    smsBody: `Hi ${customerName}, thanks for choosing us for ${jobTitle}! We'd love a quick review.`,
  };
}

// ── Helpers ─────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
