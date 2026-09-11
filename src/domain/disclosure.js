/**
 * May the agent tell this seller what the buyer expects to pay?
 *
 * The buyer's target is private. The one circumstance in which it may be stated
 * is that the seller asked for it - which makes this a DISCLOSURE DECISION, and
 * a disclosure decision cannot be delegated to a language model. A model that
 * can be prompted into answering "yes" is a model that can be prompted into
 * revealing the buyer's negotiating position. So this is a pure predicate over
 * text, with rules that can be read, argued with and tested.
 *
 * ONE SIMPLIFYING FACT: this predicate is only ever applied to text the SELLER
 * wrote. In seller-authored text the second person is the buyer, so "your
 * budget", "your best price" and "what are you expecting" all ask about OUR
 * side. First-person markers ("my rate", "our price") are about THEIRS.
 */

/** Split on sentence terminators, keeping the terminator with the sentence. */
function sentences(text) {
  return String(text)
    .split(/(?<=[.?!])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * A sentence that seeks information: a question, or a polite imperative that
 * functions as one ("let me know your budget").
 */
const REQUEST_OPENERS =
  /^(?:what|which|how|why|when|where|who|do|does|did|can|could|would|will|shall|may|is|are|any|please|kindly|let me know|tell me|share|send|advise|confirm)\b/i;

function isRequestLike(sentence) {
  return sentence.includes('?') || REQUEST_OPENERS.test(sentence);
}

/** Markers that the sentence is about the BUYER's money. */
const OUR_BUDGET_MARKERS = [
  /\byour\s+(?:best\s+|target\s+|expected\s+|maximum\s+|max\s+|final\s+)?(?:budget|price|rate|offer|quote|range|expectation|figure|number)\b/i,
  /\bhow much\b[^.?!]*\b(?:pay|spend|budget|afford|offer|quoting|looking)\b/i,
  /\b(?:expect|expecting|willing|ready|looking|plan(?:ning)?)\b[^.?!]*\bto pay\b/i,
  /\btarget price\b/i,
  /\bprice range\b/i,
  /\bbudget\b/i,
];

const FIRST_PERSON = /\b(?:my|our|we|us|i)\b/i;
const SECOND_PERSON = /\b(?:you|your|yours)\b/i;

/**
 * Is the seller asking what the buyer will pay?
 *
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
export function asksOurBudget(text) {
  if (typeof text !== 'string' || !text.trim()) return false;

  for (const sentence of sentences(text)) {
    if (!isRequestLike(sentence)) continue;

    // "My best price is 850" is not a question about our budget even if it is
    // phrased oddly. Require a second-person reference when the sentence is
    // otherwise about the seller's own side.
    if (FIRST_PERSON.test(sentence) && !SECOND_PERSON.test(sentence)) continue;

    if (OUR_BUDGET_MARKERS.some((pattern) => pattern.test(sentence))) return true;
  }
  return false;
}

/**
 * What the agent is allowed to reveal in this message.
 *
 * The maximum is NEVER in this set. It is not a disclosure decision at all -
 * there is no circumstance in this system in which the buyer's ceiling is put
 * in front of a seller.
 *
 * @param {object} params
 * @param {boolean} params.sellerAskedOurBudget
 * @returns {{target: boolean, maximum: false}}
 */
export function disclosurePolicy({ sellerAskedOurBudget }) {
  return Object.freeze({
    target: Boolean(sellerAskedOurBudget),
    maximum: false,
  });
}
