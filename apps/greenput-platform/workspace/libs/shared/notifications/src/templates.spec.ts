import { describe, it, expect } from 'vitest';
import {
  newLeadAlert,
  jobStatusChange,
  paymentReceived,
  reviewRequest,
} from './templates';

describe('notification templates', () => {
  describe('newLeadAlert', () => {
    it('should generate content with lead name and source', () => {
      const result = newLeadAlert('John Doe', 'website');

      expect(result.subject).toBe('New lead: John Doe');
      expect(result.html).toContain('John Doe');
      expect(result.html).toContain('website');
      expect(result.smsBody).toContain('John Doe');
      expect(result.smsBody).toContain('website');
    });

    it('should escape HTML in lead name', () => {
      const result = newLeadAlert('<script>alert(1)</script>', 'manual');

      expect(result.html).not.toContain('<script>');
      expect(result.html).toContain('&lt;script&gt;');
    });

    it('should escape HTML in source', () => {
      const result = newLeadAlert('Alice', '<b>injection</b>');
      expect(result.html).not.toContain('<b>');
      expect(result.html).toContain('&lt;b&gt;');
    });

    it('should include smsBody with log-in prompt', () => {
      const result = newLeadAlert('Bob Smith', 'referral');
      expect(result.smsBody).toContain('Log in');
    });

    it('should return NotificationContent with subject, html, and smsBody', () => {
      const result = newLeadAlert('Alice', 'google');
      expect(result).toHaveProperty('subject');
      expect(result).toHaveProperty('html');
      expect(result).toHaveProperty('smsBody');
    });

    it('should escape ampersands in lead name', () => {
      const result = newLeadAlert('Smith & Sons', 'website');
      expect(result.html).toContain('Smith &amp; Sons');
    });
  });

  describe('jobStatusChange', () => {
    it('should generate content with job number and statuses', () => {
      const result = jobStatusChange('J-001', 'scheduled', 'in_progress');

      expect(result.subject).toContain('J-001');
      expect(result.subject).toContain('In Progress');
      expect(result.html).toContain('J-001');
      expect(result.html).toContain('Scheduled');
      expect(result.html).toContain('In Progress');
      expect(result.smsBody).toContain('J-001');
      expect(result.smsBody).toContain('In Progress');
    });

    it('should format status with spaces and title case', () => {
      const result = jobStatusChange('J-002', 'in_progress', 'completed');
      expect(result.subject).toContain('Completed');
      expect(result.html).toContain('In Progress');
      expect(result.html).toContain('Completed');
    });

    it('should handle invoiced status', () => {
      const result = jobStatusChange('J-003', 'completed', 'invoiced');
      expect(result.subject).toContain('Invoiced');
    });

    it('should handle paid status', () => {
      const result = jobStatusChange('J-004', 'invoiced', 'paid');
      expect(result.subject).toContain('Paid');
    });

    it('smsBody should include new status', () => {
      const result = jobStatusChange('J-005', 'scheduled', 'cancelled');
      expect(result.smsBody).toContain('Cancelled');
    });
  });

  describe('paymentReceived', () => {
    it('should generate content with formatted amount', () => {
      const result = paymentReceived('J-042', 1500.5);

      expect(result.subject).toContain('$1,500.50');
      expect(result.subject).toContain('J-042');
      expect(result.html).toContain('$1,500.50');
      expect(result.smsBody).toContain('$1,500.50');
    });

    it('should handle whole dollar amounts', () => {
      const result = paymentReceived('J-001', 200);

      expect(result.subject).toContain('$200.00');
    });

    it('should handle zero amount', () => {
      const result = paymentReceived('J-000', 0);
      expect(result.subject).toContain('$0.00');
    });

    it('should handle large amounts with comma formatting', () => {
      const result = paymentReceived('J-100', 10000);
      expect(result.html).toContain('$10,000.00');
    });

    it('smsBody includes job number and amount', () => {
      const result = paymentReceived('J-050', 750);
      expect(result.smsBody).toContain('J-050');
      expect(result.smsBody).toContain('$750.00');
    });
  });

  describe('reviewRequest', () => {
    it('should generate customer-facing content', () => {
      const result = reviewRequest('Jane Smith', 'Electrical Panel Upgrade');

      expect(result.subject).toContain('Electrical Panel Upgrade');
      expect(result.html).toContain('Jane Smith');
      expect(result.html).toContain('Electrical Panel Upgrade');
      expect(result.smsBody).toContain('Jane Smith');
      expect(result.smsBody).toContain('Electrical Panel Upgrade');
    });

    it('should escape HTML in customer name', () => {
      const result = reviewRequest('<strong>XSS</strong>', 'AC Repair');
      expect(result.html).toContain('&lt;strong&gt;'); // injected HTML is escaped
    });

    it('should escape HTML in job title', () => {
      const result = reviewRequest('Alice', '<script>bad</script>');
      expect(result.html).not.toContain('<script>');
      expect(result.html).toContain('&lt;script&gt;');
    });

    it('should include feedback request in smsBody', () => {
      const result = reviewRequest('Bob', 'Plumbing Repair');
      expect(result.smsBody).toContain('review');
    });

    it('subject should reference the job title', () => {
      const result = reviewRequest('Carol', 'HVAC Installation');
      expect(result.subject).toContain('HVAC Installation');
    });
  });
});
