'use strict';

const ZERO_SHA = /^0+$/;
const DEFAULT_PROTECTED = ['main', 'master', 'production', 'prod'];

function branchName(ref) {
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null;
}

// Decides whether a pre-push update deserves a pause. `isAncestor(a, b)` answers
// "is commit a already in b's history?" and is injected so this stays testable.
function classifyUpdate(update, { isAncestor, protectedBranches = DEFAULT_PROTECTED }) {
  const { localSha, remoteRef, remoteSha } = update;
  const branch = branchName(remoteRef);
  const label = branch ?? remoteRef;
  const deleting = ZERO_SHA.test(localSha);
  const creating = ZERO_SHA.test(remoteSha);

  if (deleting) {
    return { risky: branch !== null, reason: `delete ${label}` };
  }
  if (branch === null) return { risky: false, reason: `push ${label}` };

  if (!creating && !isAncestor(remoteSha, localSha)) {
    return { risky: true, reason: `force-push to ${label}` };
  }
  if (protectedBranches.includes(branch)) {
    return { risky: true, reason: `push to ${label}` };
  }
  return { risky: false, reason: `push to ${label}` };
}

function parsePrePushInput(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
      return { localRef, localSha, remoteRef, remoteSha };
    });
}

// Force-pushes are named first because they are the most destructive reason.
function riskyReasons(text, options) {
  const reasons = parsePrePushInput(text)
    .map((update) => classifyUpdate(update, options))
    .filter((result) => result.risky)
    .map((result) => result.reason);
  const rank = (reason) => (reason.startsWith('force-push') ? 0 : reason.startsWith('delete') ? 1 : 2);
  return reasons.sort((a, b) => rank(a) - rank(b));
}

module.exports = { classifyUpdate, parsePrePushInput, riskyReasons, DEFAULT_PROTECTED };
