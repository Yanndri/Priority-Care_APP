// When the website ends a disaster, the admin picks an advice for residents. It is saved in the
// disaster's resolution_reason as "Advice to residents: <advice>. Reason: <reason>".
// Older disasters have only a reason, so advice comes back null for them.
const PATTERN = /^Advice to residents: (.+?)\. Reason: ([\s\S]*)$/;

export function splitEndReason(text) {
  const m = PATTERN.exec(text || '');
  return m ? { advice: m[1], reason: m[2] } : { advice: null, reason: text || '' };
}

// true when the advice tells people they may go home.
export const isGoHome = (advice) => /go home/i.test(advice || '');
