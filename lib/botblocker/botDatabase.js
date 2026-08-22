'use strict';

/*
 * AI Crawler & LLM Bot Blocker, bot database.
 *
 * Single source of truth for every known crawler the tool can act on.
 * Keep entries structured so the database is easy to update: add or edit a
 * record below and every generator, simulator, analyzer and the UI follow.
 *
 * Honesty rules baked into the schema:
 *  - `confidence` reflects how well the record is documented, not a guess.
 *  - `officialDocumentation` is only set when a public vendor page exists.
 *  - `robotsSupport` describes what the operator documents, never a guarantee.
 *  - `category` is based on documented behavior, never on the bot's name.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else {
    const BB = root.BB = root.BB || {};
    BB.botDatabase = factory(name => {
      const key = name.replace(/^\.\//, '');
      if (!BB[key]) throw new Error('botblocker module missing: ' + name);
      return BB[key];
    });
  }
})(typeof self !== 'undefined' ? self : globalThis, function (require) {

  const DB_VERSION = '2026.08.1';
  const DB_UPDATED = '2026-08-01';

  /* category values: training | search | retrieval | user | extraction | other | unknown */
  const BOTS = [
    {
      id: 'gptbot', name: 'GPTBot', token: 'GPTBot', organization: 'OpenAI',
      category: 'training',
      purpose: 'Crawls publicly accessible web pages to collect content used as training data for OpenAI models.',
      userAgents: ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)'],
      officialDocumentation: 'https://platform.openai.com/docs/bots',
      robotsSupport: 'documented-yes',
      technicalBlockingNotes: 'OpenAI documents the crawler and publishes verification guidance on its bots page; User-Agent rules can be enforced at server level, but User-Agent values can be spoofed.',
      verificationNotes: 'Documented by OpenAI. Follows robots.txt per its documentation.',
      lastVerified: '2026-08-01', confidence: 'high', recommended: 'block'
    },
    {
      id: 'oai-searchbot', name: 'OAI-SearchBot', token: 'OAI-SearchBot', organization: 'OpenAI',
      category: 'search',
      purpose: 'Indexes web pages so they can be surfaced as cited sources in ChatGPT search results.',
      userAgents: ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)'],
      officialDocumentation: 'https://platform.openai.com/docs/bots',
      robotsSupport: 'documented-yes',
      technicalBlockingNotes: 'OpenAI publishes a JSON list of search crawler IP ranges (searchbot.json) that can support stronger verification than User-Agent alone.',
      verificationNotes: 'Blocking affects visibility of your pages inside ChatGPT search results, not model training (GPTBot is the training crawler).',
      lastVerified: '2026-08-01', confidence: 'high', recommended: 'allow'
    },
    {
      id: 'chatgpt-user', name: 'ChatGPT-User', token: 'ChatGPT-User', organization: 'OpenAI',
      category: 'user',
      purpose: 'Fetches pages in real time when a ChatGPT user explicitly asks for a page or link preview.',
      userAgents: ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ChatGPT-User/1.0; +https://openai.com/chatgpt-user)'],
      officialDocumentation: 'https://platform.openai.com/docs/bots',
      robotsSupport: 'documented-partial',
      technicalBlockingNotes: 'OpenAI notes user-initiated fetchers behave differently from autonomous crawlers; treat robots.txt compliance as partial, not guaranteed.',
      verificationNotes: 'User-initiated retrieval: blocking may degrade link previews and on-request browsing for ChatGPT users.',
      lastVerified: '2026-08-01', confidence: 'high', recommended: 'default'
    },
    {
      id: 'claudebot', name: 'ClaudeBot', token: 'ClaudeBot', organization: 'Anthropic',
      category: 'training',
      purpose: "Crawls publicly accessible web pages to collect training data for Anthropic's Claude models.",
      userAgents: ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.2; +claudebot@anthropic.com)'],
      officialDocumentation: 'https://claude.com/crawling',
      robotsSupport: 'documented-yes',
      technicalBlockingNotes: 'Anthropic documents its crawlers and publishes machine-readable bot/IP information; User-Agent rules remain spoofable.',
      verificationNotes: 'Documented by Anthropic. Follows robots.txt including Crawl-delay per its documentation.',
      lastVerified: '2026-08-01', confidence: 'high', recommended: 'block'
    },
    {
      id: 'claude-user', name: 'Claude-User', token: 'Claude-User', organization: 'Anthropic',
      category: 'user',
      purpose: 'Fetches a web page when a Claude user explicitly asks Claude to visit or read that page.',
      userAgents: ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +claude-user@anthropic.com)'],
      officialDocumentation: 'https://claude.com/crawling',
      robotsSupport: 'documented-yes',
      technicalBlockingNotes: 'Anthropic states Claude-User honors robots.txt; blocking may reduce how your pages appear in user-directed answers.',
      verificationNotes: 'Anthropic documents that blocking it may reduce visibility for user-directed web search in Claude.',
      lastVerified: '2026-08-01', confidence: 'high', recommended: 'default'
    },
    {
      id: 'claude-searchbot', name: 'Claude-SearchBot', token: 'Claude-SearchBot', organization: 'Anthropic',
      category: 'search',
      purpose: 'Indexes web content to improve search result quality inside Claude.',
      userAgents: ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +clausesearchbot@anthropic.com)'],
      officialDocumentation: 'https://claude.com/crawling',
      robotsSupport: 'documented-yes',
      technicalBlockingNotes: 'Search indexing crawler; blocking removes your content from Claude search indexing.',
      verificationNotes: 'Anthropic documents that blocking it may reduce your site\u2019s visibility and accuracy in user search results.',
      lastVerified: '2026-08-01', confidence: 'high', recommended: 'allow'
    },
    {
      id: 'anthropic-ai', name: 'anthropic-ai (legacy)', token: 'anthropic-ai', organization: 'Anthropic',
      category: 'retrieval', deprecated: true,
      purpose: 'Legacy Anthropic user agent used for Claude content retrieval before the current ClaudeBot/Claude-User tokens. Reported deprecated; still seen in logs.',
      userAgents: ['anthropic-ai'],
      officialDocumentation: 'https://claude.com/crawling',
      robotsSupport: 'documented-yes',
      technicalBlockingNotes: 'Legacy token. Keeping or blocking it is low impact; current traffic uses the documented Claude tokens.',
      verificationNotes: 'Claude-Web and anthropic-ai were the pre-ClaudeBot identifiers; Anthropic lists them as deprecated.',
      lastVerified: '2026-08-01', confidence: 'medium', recommended: 'default'
    },
    {
      id: 'google-extended', name: 'Google-Extended', token: 'Google-Extended', organization: 'Google',
      category: 'training',
      purpose: 'Control token, not a crawler: it does not fetch pages. Disallowing it opts your content out of being used to train Google\u2019s foundation models (Gemini). Googlebot still crawls for Search.',
      userAgents: [],
      officialDocumentation: 'https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers',
      robotsSupport: 'documented-yes',
      technicalBlockingNotes: 'There is no Google-Extended crawler traffic to block at server level, this token only changes how already-crawled Googlebot data may be used. A User-Agent block for it would match nothing real.',
      verificationNotes: 'Important accuracy note: a robots.txt rule for Google-Extended does NOT block Googlebot crawling and does not remove pages from Google Search.',
      lastVerified: '2026-08-01', confidence: 'high', recommended: 'block'
    },
    {
      id: 'google-cloudvertexbot', name: 'Google-CloudVertexBot', token: 'Google-CloudVertexBot', organization: 'Google',
      category: 'training',
      purpose: 'Google Cloud token controlling whether crawled content may be used to train or ground foundation models for Google Cloud Vertex AI customers.',
      userAgents: [],
      officialDocumentation: 'https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers',
      robotsSupport: 'documented-yes',
      technicalBlockingNotes: 'Like Google-Extended, this is a usage-control token rather than a standalone crawler, check Google\u2019s crawler documentation for current behavior.',
      verificationNotes: 'Listed in Google\u2019s official crawler overview; consult that page before acting.',
      lastVerified: '2026-08-01', confidence: 'medium', recommended: 'default'
    },
    {
      id: 'applebot', name: 'Applebot', token: 'Applebot', organization: 'Apple',
      category: 'search',
      purpose: "Apple's web crawler that powers search features across Apple products (Spotlight, Siri, Safari suggestions). Not an AI-training crawler by itself.",
      userAgents: ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1) AppleWebKit/600.1.25 (KHTML, like Gecko) Version/8.0 Safari/600.1.25 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)'],
      officialDocumentation: 'https://support.apple.com/en-us/119829',
      robotsSupport: 'documented-yes',
      technicalBlockingNotes: 'Apple documents verification via reverse DNS. Blocking Applebot affects Spotlight/Siri/Safari visibility. User-Agent blocking also accidentally catches other Applebot-based agents, use the exact token.',
      verificationNotes: 'Do not confuse with Applebot-Extended: a rule for "Applebot" does not control the training-permission token Applebot-Extended, and vice versa. If robots.txt mentions Googlebot but not Applebot, Applebot follows the Googlebot rules.',
      lastVerified: '2026-08-01', confidence: 'high', recommended: 'allow'
    },
    {
      id: 'applebot-extended', name: 'Applebot-Extended', token: 'Applebot-Extended', organization: 'Apple',
      category: 'training',
      purpose: 'Control token, not a crawler: determines whether content already crawled by Applebot may be used to train Apple\u2019s foundation models powering generative AI features. Does not crawl and does not remove pages from Apple search results.',
      userAgents: [],
      officialDocumentation: 'https://support.apple.com/en-us/119829',
      robotsSupport: 'documented-yes',
      technicalBlockingNotes: 'No standalone traffic exists to block at server level; the token only changes how Applebot-crawled data may be used for training.',
      verificationNotes: 'Apple states that even with Applebot-Extended disallowed, Applebot may still crawl and content can remain discoverable via Spotlight, Siri and Safari.',
      lastVerified: '2026-08-01', confidence: 'high', recommended: 'block'
    },
    {
      id: 'perplexitybot', name: 'PerplexityBot', token: 'PerplexityBot', organization: 'Perplexity',
      category: 'search',
      purpose: 'Indexes web content so it can be retrieved and cited in Perplexity AI search answers.',
      userAgents: ['Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)'],
      officialDocumentation: 'https://docs.perplexity.ai/guides/bots',
      robotsSupport: 'documented-yes',
      technicalBlockingNotes: 'Perplexity publishes crawler IP ranges in machine-readable form, which supports stronger verification than User-Agent alone.',
      verificationNotes: 'Documented as robots-respecting, but third-party reports (notably Cloudflare, 2025) documented Perplexity-associated stealth crawlers circumventing robots.txt, do not treat robots.txt as guaranteed enforcement.',
      lastVerified: '2026-08-01', confidence: 'high', recommended: 'allow'
    },
    {
      id: 'perplexity-user', name: 'Perplexity-User', token: 'Perplexity-User', organization: 'Perplexity',
      category: 'user',
      purpose: 'Fetches a specific page in real time when a Perplexity user asks about it.',
      userAgents: ['Mozilla/5.0 (compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)'],
      officialDocumentation: 'https://docs.perplexity.ai/guides/bots',
      robotsSupport: 'documented-no',
      technicalBlockingNotes: 'Perplexity states this user-initiated fetcher generally does not apply robots.txt rules, server/CDN-level blocking is the only reliable control for it.',
      verificationNotes: 'User-initiated fetcher; robots.txt is documented as not generally applied to it.',
      lastVerified: '2026-08-01', confidence: 'high', recommended: 'default'
    },
    {
      id: 'amazonbot', name: 'Amazonbot', token: 'Amazonbot', organization: 'Amazon',
      category: 'training',
      purpose: "Amazon's web crawler that collects content used to build search and AI answer features (for example Alexa).",
      userAgents: ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1) AppleWebKit/600.1.25 (KHTML, like Gecko) Version/8.0 Safari/600.1.25 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)'],
      officialDocumentation: 'https://developer.amazon.com/amazonbot',
      robotsSupport: 'documented-yes',
      technicalBlockingNotes: 'Amazon documents the crawler and publishes its IP ranges, supporting verification stronger than User-Agent matching.',
      verificationNotes: 'Documented by Amazon. Serves both search indexing and AI answer generation, so blocking affects both.',
      lastVerified: '2026-08-01', confidence: 'high', recommended: 'default'
    },
    {
      id: 'bytespider', name: 'Bytespider', token: 'Bytespider', organization: 'ByteDance',
      category: 'training',
      purpose: 'ByteDance web crawler associated with content collection used across ByteDance products, including AI features; widely reported to be very aggressive.',
      userAgents: ['Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)'],
      officialDocumentation: null,
      robotsSupport: 'reported-mixed',
      technicalBlockingNotes: 'ByteDance publishes crawler information mainly on its Chinese webmaster portal (zhanzhang.toutiao.com). Because robots compliance is reported as inconsistent, server/CDN-level enforcement is recommended if you want this crawler blocked.',
      verificationNotes: 'No English official documentation found as of the database date; classification based on widespread operator reports and third-party studies. Confidence is medium on purpose details.',
      lastVerified: '2026-08-01', confidence: 'medium', recommended: 'block'
    },
    {
      id: 'ccbot', name: 'CCBot (Common Crawl)', token: 'CCBot', organization: 'Common Crawl',
      category: 'training',
      purpose: 'Crawls the web to build the open Common Crawl corpus, a dataset widely used downstream for AI training and research.',
      userAgents: ['CCBot/1.0 (+https://commoncrawl.org/faq/)'],
      officialDocumentation: 'https://commoncrawl.org/big-picture/frequently-asked-questions/',
      robotsSupport: 'documented-yes',
      technicalBlockingNotes: 'Common Crawl documents respect for robots.txt; the corpus is republished, so opted-in content keeps circulating in older snapshots.',
      verificationNotes: 'Documented by Common Crawl. Remember old crawls cannot be retroactively blocked.',
      lastVerified: '2026-08-01', confidence: 'high', recommended: 'block'
    },
    {
      id: 'meta-externalagent', name: 'Meta-ExternalAgent', token: 'Meta-ExternalAgent', organization: 'Meta',
      category: 'training',
      purpose: "Meta's crawler for training data and AI indexing used across Meta AI products.",
      userAgents: ['meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)'],
      officialDocumentation: 'https://developers.facebook.com/docs/sharing/webmasters/crawler',
      robotsSupport: 'documented-yes',
      technicalBlockingNotes: 'Documented by Meta. User-Agent rules remain spoofable; verify against Meta\u2019s published crawler information.',
      verificationNotes: 'Follows robots.txt per Meta\u2019s crawler documentation.',
      lastVerified: '2026-08-01', confidence: 'high', recommended: 'block'
    },
    {
      id: 'meta-externalfetcher', name: 'Meta-ExternalFetcher', token: 'Meta-ExternalFetcher', organization: 'Meta',
      category: 'user',
      purpose: 'Fetches content in real time for Meta AI assistant features and user-initiated link processing.',
      userAgents: ['meta-externalfetcher/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)'],
      officialDocumentation: 'https://developers.facebook.com/docs/sharing/webmasters/crawler',
      robotsSupport: 'documented-yes',
      technicalBlockingNotes: 'Blocking affects Meta link previews and Meta AI retrieval of your pages.',
      verificationNotes: 'Documented by Meta as the user-initiated fetcher, separate from Meta-ExternalAgent.',
      lastVerified: '2026-08-01', confidence: 'high', recommended: 'default'
    },
    {
      id: 'facebookbot', name: 'FacebookBot (legacy)', token: 'FacebookBot', organization: 'Meta',
      category: 'training', deprecated: true,
      purpose: 'Legacy Meta AI-related crawler token, superseded by Meta-ExternalAgent / Meta-ExternalFetcher; occasionally still seen.',
      userAgents: ['facebookcatalog/1.0'],
      officialDocumentation: 'https://developers.facebook.com/docs/sharing/webmasters/crawler',
      robotsSupport: 'unknown',
      technicalBlockingNotes: 'Legacy token with little current traffic; keep for historical coverage only.',
      verificationNotes: 'Meta\u2019s current crawler documentation centers on Meta-ExternalAgent/Meta-ExternalFetcher.',
      lastVerified: '2026-08-01', confidence: 'medium', recommended: 'default'
    },
    {
      id: 'youbot', name: 'YouBot', token: 'YouBot', organization: 'you.com',
      category: 'search',
      purpose: 'Crawler associated with you.com search and AI answer features.',
      userAgents: ['Mozilla/5.0 (compatible; YouBot/1.0; +http://you.com/youbot)'],
      officialDocumentation: null,
      robotsSupport: 'unknown',
      technicalBlockingNotes: 'No official crawler documentation found; behavior reports come from third-party directories. Verify traffic in your own logs before enforcing.',
      verificationNotes: 'No official documentation found as of the database date, classification confidence is low.',
      lastVerified: '2026-08-01', confidence: 'low', recommended: 'default'
    },
    {
      id: 'duckassistbot', name: 'DuckAssistBot', token: 'DuckAssistBot', organization: 'DuckDuckGo',
      category: 'retrieval',
      purpose: 'Crawls pages in real time for DuckDuckGo\u2019s DuckAssist AI-assisted answers, which cite their sources. DuckDuckGo states this data is not used to train AI models.',
      userAgents: ['DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)'],
      officialDocumentation: 'https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot',
      robotsSupport: 'documented-yes',
      technicalBlockingNotes: 'DuckDuckGo documents published IP ranges and honors robots.txt opt-outs (stated to take effect within about 72 hours).',
      verificationNotes: 'Retrieval for cited AI answers, explicitly documented as not training.',
      lastVerified: '2026-08-01', confidence: 'high', recommended: 'allow'
    },
    {
      id: 'mistralai-index', name: 'MistralAI-Index', token: 'MistralAI-Index', organization: 'Mistral AI',
      category: 'search',
      purpose: 'Indexes web content for Mistral AI search (Vibe).',
      userAgents: ['Mozilla/5.0 (compatible; MistralAI-Index/1.0; +https://docs.mistral.ai/)'],
      officialDocumentation: null,
      robotsSupport: 'documented-yes',
      technicalBlockingNotes: 'The user agent references Mistral\u2019s documentation; verify current tokens against Mistral\u2019s docs before enforcing server rules.',
      verificationNotes: 'Reported to respect robots.txt; official documentation URL not stable as of the database date.',
      lastVerified: '2026-08-01', confidence: 'medium', recommended: 'allow'
    },
    {
      id: 'mistralai-user', name: 'MistralAI-User', token: 'MistralAI-User', organization: 'Mistral AI',
      category: 'user',
      purpose: 'Fetches pages on behalf of Mistral AI users (user-initiated retrieval).',
      userAgents: ['Mozilla/5.0 (compatible; MistralAI-User/1.0; +https://docs.mistral.ai/)'],
      officialDocumentation: null,
      robotsSupport: 'unknown',
      technicalBlockingNotes: 'User-initiated fetcher; robots compliance uncertain, treat server/CDN rules as the reliable control.',
      verificationNotes: 'Token observed in the wild; verify against Mistral\u2019s documentation.',
      lastVerified: '2026-08-01', confidence: 'medium', recommended: 'default'
    },
    {
      id: 'cohere-ai', name: 'cohere-ai', token: 'cohere-ai', organization: 'Cohere',
      category: 'training',
      purpose: 'Crawler associated with Cohere data collection for models and enterprise retrieval.',
      userAgents: ['cohere-ai'],
      officialDocumentation: null,
      robotsSupport: 'unknown',
      technicalBlockingNotes: 'No official crawler documentation found; verify traffic in your own logs before enforcing.',
      verificationNotes: 'No official documentation found as of the database date, classification confidence is medium-low.',
      lastVerified: '2026-08-01', confidence: 'low', recommended: 'default'
    },
    {
      id: 'diffbot', name: 'Diffbot', token: 'Diffbot', tokenAlt: [], organization: 'Diffbot',
      category: 'extraction',
      purpose: 'Automated structured-data extraction and knowledge-graph crawling for Diffbot\u2019s APIs; content extraction rather than model training.',
      userAgents: ['Mozilla/5.0 (compatible; Diffbot/0.1; +http://www.diffbot.com)'],
      officialDocumentation: null,
      robotsSupport: 'documented-partial',
      technicalBlockingNotes: 'Diffbot states its crawlers adhere to robots.txt by default unless overridden by customer agreement.',
      verificationNotes: 'Extraction service crawler; purpose per operator statements and third-party reports.',
      lastVerified: '2026-08-01', confidence: 'medium', recommended: 'default'
    },
    {
      id: 'omgilibot', name: 'Omgilibot / Omgili', token: 'Omgilibot', organization: 'Webz.io (formerly Webhose)',
      category: 'training',
      purpose: 'Long-running dataset aggregation crawler whose historic archives have been used for NLP and AI training datasets.',
      userAgents: ['Mozilla/5.0 (compatible; Omgilibot/0.3; +http://www.webz.io/bot)'],
      officialDocumentation: null,
      robotsSupport: 'unknown',
      technicalBlockingNotes: 'Legacy token; successor Webz.io crawlers are documented as robots-respecting, but this token itself is undocumented.',
      verificationNotes: 'Historic crawler; low confidence on current behavior.',
      lastVerified: '2026-08-01', confidence: 'low', recommended: 'default'
    },
    {
      id: 'ai2bot', name: 'AI2Bot', token: 'AI2Bot', organization: 'Allen Institute for AI',
      category: 'training',
      purpose: 'Crawler associated with Allen Institute for AI data collection for open datasets and research.',
      userAgents: ['Mozilla/5.0 (compatible; AI2Bot/1.0; +https://allenai.org)'],
      officialDocumentation: null,
      robotsSupport: 'unknown',
      technicalBlockingNotes: 'Academic crawler; verify traffic in logs before enforcing.',
      verificationNotes: 'Token reported by operators; official documentation page not confirmed as of the database date.',
      lastVerified: '2026-08-01', confidence: 'medium', recommended: 'default'
    },
    {
      id: 'ai2bot-dolma', name: 'AI2Bot-Dolma', token: 'AI2Bot-Dolma', organization: 'Allen Institute for AI',
      category: 'training',
      purpose: 'Crawler associated with building the Dolma open training corpus used for AI research.',
      userAgents: ['Mozilla/5.0 (compatible; AI2Bot-Dolma/1.0; +https://github.com/allenai/dolma)'],
      officialDocumentation: 'https://github.com/allenai/dolma',
      robotsSupport: 'documented-yes',
      technicalBlockingNotes: 'Dolma project documents its crawl; corpus snapshots already published cannot be recalled.',
      verificationNotes: 'Documented via the Dolma project.',
      lastVerified: '2026-08-01', confidence: 'medium', recommended: 'default'
    },
    {
      id: 'timpibot', name: 'Timpibot', token: 'Timpibot', organization: 'Timpi',
      category: 'search',
      purpose: 'Crawler for the Timpi search index used by AI-oriented applications.',
      userAgents: ['Mozilla/5.0 (compatible; Timpibot/1.0; +https://timpi.io)'],
      officialDocumentation: null,
      robotsSupport: 'unknown',
      technicalBlockingNotes: 'No official crawler documentation found; verify before enforcing.',
      verificationNotes: 'Third-party reports only, low confidence.',
      lastVerified: '2026-08-01', confidence: 'low', recommended: 'default'
    },
    {
      id: 'googleother', name: 'GoogleOther', token: 'GoogleOther', organization: 'Google',
      category: 'other',
      purpose: "Generic Google fetcher used by internal product teams for one-off fetching and analysis. Google documents it separately from Google's search crawlers and AI-related tokens, it is not an AI training agent.",
      userAgents: ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GoogleOther; +https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers)'],
      officialDocumentation: 'https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers',
      robotsSupport: 'documented-yes',
      technicalBlockingNotes: 'Included to demonstrate the tool does not classify bots by name: despite the name, Google documents this as a general-purpose internal agent, not AI training.',
      verificationNotes: 'Listed in Google\u2019s official crawler overview.',
      lastVerified: '2026-08-01', confidence: 'high', recommended: 'default'
    }
  ];

  const CATEGORY_LABELS = {
    training: 'AI Training',
    search: 'AI Search',
    retrieval: 'AI Assistant Retrieval',
    user: 'User-Initiated Browsing',
    extraction: 'Content Extraction',
    other: 'Other Automated',
    unknown: 'Unknown AI Bot'
  };
  const CATEGORY_ORDER = ['training', 'search', 'retrieval', 'user', 'extraction', 'other', 'unknown'];

  const AI_CATEGORIES = ['training', 'search', 'retrieval', 'user', 'extraction', 'unknown'];

  function all() { return BOTS.slice(); }
  function get(id) { return BOTS.find(b => b.id === id) || null; }
  function byToken(token) {
    const t = String(token || '').toLowerCase();
    return BOTS.find(b => b.token.toLowerCase() === t) || null;
  }
  function byCategory(cat) { return BOTS.filter(b => b.category === cat); }
  function stats() {
    const by = {};
    for (const c of CATEGORY_ORDER) by[c] = 0;
    let withDocs = 0, highConfidence = 0;
    for (const b of BOTS) { by[b.category]++; if (b.officialDocumentation) withDocs++; if (b.confidence === 'high') highConfidence++; }
    return {
      total: BOTS.length, aiRelated: BOTS.filter(b => AI_CATEGORIES.includes(b.category)).length,
      byCategory: by, withDocumentation: withDocs, highConfidence, version: DB_VERSION, updated: DB_UPDATED
    };
  }
  function search(q) {
    const s = String(q || '').toLowerCase().trim();
    if (!s) return all();
    return BOTS.filter(b =>
      b.name.toLowerCase().includes(s) ||
      b.token.toLowerCase().includes(s) ||
      b.organization.toLowerCase().includes(s) ||
      (b.userAgents || []).some(u => u.toLowerCase().includes(s)));
  }

  return { BOTS, DB_VERSION, DB_UPDATED, CATEGORY_LABELS, CATEGORY_ORDER, AI_CATEGORIES, all, get, byToken, byCategory, stats, search };
});
