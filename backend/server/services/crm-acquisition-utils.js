function optionalCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
}

function optionalMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
}

function percentage(part, total) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null;
  return Math.round((part / total) * 10000) / 100;
}

export function reconcileAcquisitionSources({
  attributedConversations,
  observedChats,
  spend,
} = {}) {
  const attributed = optionalCount(attributedConversations);
  const observed = optionalCount(observedChats);
  const normalizedSpend = optionalMoney(spend);

  if (attributed === null || observed === null) {
    return {
      available: false,
      status: 'source-unavailable',
      attributedConversations: attributed,
      observedChats: observed,
      attributedWithinObservedChats: null,
      unattributedChats: null,
      excessAttributedConversations: null,
      attributedShare: null,
      unattributedShare: null,
      costPerAttributedConversation: attributed > 0 && normalizedSpend !== null
        ? normalizedSpend / attributed
        : null,
    };
  }

  const attributedWithinObservedChats = Math.min(attributed, observed);
  const unattributedChats = Math.max(0, observed - attributed);
  const excessAttributedConversations = Math.max(0, attributed - observed);

  return {
    available: true,
    status: excessAttributedConversations > 0 ? 'sources-not-reconciled' : 'reconciled',
    attributedConversations: attributed,
    observedChats: observed,
    attributedWithinObservedChats,
    unattributedChats,
    excessAttributedConversations,
    attributedShare: percentage(attributedWithinObservedChats, observed),
    unattributedShare: percentage(unattributedChats, observed),
    costPerAttributedConversation: attributed > 0 && normalizedSpend !== null
      ? normalizedSpend / attributed
      : null,
  };
}
