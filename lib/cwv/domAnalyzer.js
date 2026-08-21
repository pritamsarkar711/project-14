'use strict';

/*
 * Core Web Vitals & INP Auditor — DOM analysis.
 * Node count, depth, largest subtrees and dynamically-added nodes from
 * the live rendered document. Node-count guidance is explicitly
 * heuristic: web.dev suggests keeping DOM size below ~800 nodes (Lighthouse
 * audit), and this is presented as a heuristic, not a hard rule.
 */

function analyzeDom(dom) {
  const d = dom || {};
  const out = {
    status: typeof d.nodeCount === 'number' ? 'measured' : 'unavailable',
    nodeCount: typeof d.nodeCount === 'number' ? d.nodeCount : null,
    maxDepth: typeof d.maxDepth === 'number' ? d.maxDepth : null,
    textNodes: typeof d.textNodeCount === 'number' ? d.textNodeCount : null,
    bodyBytes: typeof d.bodyBytes === 'number' ? d.bodyBytes : null,
    largestSubtrees: Array.isArray(d.largestSubtrees) ? d.largestSubtrees.slice(0, 5) : [],
    dynamicAdded: typeof d.dynamicAdded === 'number' ? d.dynamicAdded : null,
    tagCounts: d.tagCounts || {},
    iframes: typeof d.iframes === 'number' ? d.iframes : null,
    issues: [],
    note: 'Node-count guidance is a heuristic (Lighthouse suggests ~800 nodes); it is not a pass/fail rule.'
  };
  if (out.status === 'unavailable') return out;
  if (out.nodeCount > 5000) {
    out.issues.push({
      id: 'dom-very-large', severity: 'high',
      title: 'Very large DOM (' + out.nodeCount.toLocaleString('en-US') + ' nodes)',
      detail: 'DOM size beyond ~5,000 nodes measurably increases style/layout cost and memory on low-end devices. This is a heuristic, not a hard limit.',
      evidence: out.nodeCount.toLocaleString('en-US') + ' nodes measured, max depth ' + out.maxDepth + '.'
    });
  } else if (out.nodeCount > 1500) {
    out.issues.push({
      id: 'dom-large', severity: 'medium',
      title: 'Large DOM (' + out.nodeCount.toLocaleString('en-US') + ' nodes)',
      detail: 'Above the ~800-node Lighthouse heuristic; likely fine on desktops but consider trimming repeated subtrees.',
      evidence: out.nodeCount.toLocaleString('en-US') + ' nodes measured.'
    });
  }
  if (out.maxDepth && out.maxDepth > 40) {
    out.issues.push({
      id: 'dom-deep', severity: 'low',
      title: 'Deep DOM nesting (depth ' + out.maxDepth + ')',
      detail: 'Excessive nesting complicates layout and selector matching. Heuristic.',
      evidence: 'Max depth ' + out.maxDepth + '.'
    });
  }
  if (out.largestSubtrees.length) {
    const big = out.largestSubtrees[0];
    out.issues.push({
      id: 'dom-subtree', severity: 'low',
      title: 'Largest subtree: ' + big.selector + ' (' + big.count + ' nodes)',
      detail: 'Large repeated subtrees are the usual DOM-size driver. Heuristic observation.',
      evidence: big.selector + ' contains ' + big.count + ' nodes.'
    });
  }
  return out;
}

module.exports = { analyzeDom };
