import { ASSISTANT_IDENTITY_GUARD_PATTERN, evaluateSearchRoute } from "./search-router.js";

const URL_OR_DOMAIN_PATTERN =
  /https?:\/\/[^\s]+|www\.[^\s]+|\b[a-zA-Z0-9-]+\.(?:az|com|org|net|io|co|ai|edu|gov|tr|ru|tech|biz|info|me|app)\b/i;

const EXPLICIT_SEARCH_DIRECTIVE_PATTERN =
  /(?:google(?:-da)?\s+axtar|internet(?:d[əe])?\s+(?:axtar|ara[sş]d[ıi]r|yoxla|bax)|(?:veb|web)(?:-?d[əe])?\s+(?:axtar|ara[sş]d[ıi]r|yoxla|bax)|m[əe]nb[əe](?:l[əe]r(?:i|ini)?|sini|ni)?\s+(?:g[oö]st[əe]r|tap|ver|axtar|yoxla|g[əe]tir)|(?<![\p{L}\p{N}])m[əe]nb[əe](?:si)?\s+n[əe]dir|(?<![\p{L}\p{N}])(?:m[əe]nb[əe]l[əe]rl[əe]|m[əe]nb[əe]\s+il[əe])|search\s+online|find\s+online|look\s+up\s+(?:online|on\s+the\s+web)|search\s+the\s+web|^\s*(?:axtar|ara[sş]d[ıi]r|vebd[əe]\s+yoxla|internetd[əe]\s+yoxla)\s*[!?.…]*\s*$|\bsearch\s+(?:for|about|online|web|google|news|latest)\b|(?<![\p{L}\p{N}])(?:axtar(?:[ıi]b\s+tap|[ıi]n)?|ara[sş]d[ıi]r(?:[ıi]n)?)(?![\p{L}\p{N}]))/iu;

const NON_WEB_SEARCH_FALSE_POSITIVE_PATTERN =
  /(?:axtar[ıi][sş]\s+(?:alqoritm[\p{L}]*|motor[\p{L}]*|sistem[\p{L}]*|indeks[\p{L}]*|a[çc]ar[\p{L}]*)|(?:binary|linear|depth-first|breadth-first|tree|graph|vector|semantic|full-text)\s+search|search\s+(?:algorithm|engine|bar|input|box|query|index|tree|space|function|method|complexity|sort)|(?:bazar|m[üu][şs]t[əe]ri|auditoriya)\s+ara[sş]d[ıi]rmas[ıi])/iu;

const AI_MODEL_ENTITY_PATTERN =
  /(?<![\p{L}\p{N}])(?:gpt(?:[- ]?\d[\w.-]*)?|openai|o[134](?:[- ](?:mini|pro))?|claude(?:[- ]?\d[\w.-]*)?|anthropic|gemini(?:[- ]?\d[\w.-]*)?|deepmind|llama(?:[- ]?\d[\w.-]*)?|mistral|mixtral|deepseek(?:[- ]?[rv]\d[\w.-]*)?|grok(?:[- ]?\d[\w.-]*)?|qwen(?:[- ]?\d[\w.-]*)?|perplexity|chatgpt|sonnet|opus|haiku|sora|veo)(?![\p{L}\p{N}])/iu;

const AI_MODEL_LIVE_QUALIFIER_PATTERN =
  /(?:model\s+versiya[\p{L}]*|versiya[\p{L}]*|reliz[\p{L}]*|release[\p{L}]*|yenilik[\p{L}]*|yeni\s+(?:model|versiya|burax[ıi]l[ıi][sş]|x[üu]susiyy[əe]t|funksiya|[çc][ıi]x[\p{L}]*)|x[üu]susiyy[əe]t[\p{L}]*|imkanlar[ıi]?|f[əe]rq[\p{L}]*|m[üu]qayis[əe][\p{L}]*|\bvs\.?\b|\bcompare\b|comparison|qiym[əe]t[\p{L}]*|pricing|price|cost|token\s+qiym[əe]t|tarif[\p{L}]*|api\s+(?:qiym[əe]t|price|pricing|cost|limit|rate)|benchmark[\p{L}]*|skor[\p{L}]*|leaderboard|arena|context\s+window|kontekst|burax[ıi]l[ıi][sş]|[çc][ıi]x[ıi]b|[çc][ıi]xd[ıi]|[çc][ıi]xacaq|n[əe]\s+vaxt|ən\s+son|latest|newest|flagship|flaqman|capabilities|features|specs|hans[ıi]d[ıi]r|hans[ıi]\s+(?:yax[şs][ıi]d[ıi]r|g[üu]cl[üu]d[üu]r|s[üu]r[əe]tlidir|ucuzdur)|better|faster|cheaper)/iu;

const AI_STANDALONE_LIVE_PATTERN =
  /(?:api\s+qiym[əe]t[\p{L}]*|llm\s+(?:benchmark|reliz|qiym[əe]t|m[üu]qayis[əe]|pricing|leaderboard|release)|model\s+versiyas[ıi]|ai\s+benchmark[\p{L}]*|ən\s+yax[şs][ıi]\s+(?:ai|llm)\s+model)/iu;

const LIVE_REALTIME_FAST_PATH_PATTERN =
  /(?:(?<![\p{L}\p{N}])(?:2025|2026|2027)(?![\p{L}\p{N}])|(?:bu\s+g[üu]n(?:k[üu])?|bug[üu]n(?:k[üu])?|haz[ıi]rk[ıi]|hal-?haz[ıi]rk[ıi]|son\s+x[əe]b[əe]r[\p{L}]*|g[üu]n[üu]n\s+x[əe]b[əe]r[\p{L}]*|son\s+d[əe]qiq[əe]|t[əe]cili\s+x[əe]b[əe]r|\b(?:today'?s|latest\s+news|breaking\s+news|current\s+(?:price|rate|weather|score|ceo|president|prime\s+minister|status|news|market))\b)|(?:(?<![\p{L}\p{N}])hava(?:n[ıi]n)?\s+(?:proqnoz[\p{L}]*|nec[əe]|ş[əe]rait[\p{L}]*|temperatur[\p{L}]*|durumu|v[əe]ziyy[əe]t[\p{L}]*|haqq[ıi]nda|ya[gğ][ıi][şs]|qar|isti|soyuq|ne[cç][əe]|olacaq)|(?<![\p{L}\p{N}])(?:bak[ıi](?:da)?|g[əe]nc[əe](?:d[əe])?|sumqay[ıi]t(?:da)?|sabah|bug[üu]n|bu\s+g[üu]n|indi)\s+hava(?![\p{L}\p{N}])|\bweather(?:\s+(?:forecast|in|today|tomorrow|now))?\b)|(?:(?<![\p{L}\p{N}])(?:qiym[əe]ti|qiym[əe]tl[əe]ri)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])valyuta(?:\s+(?:m[əe]z[əe]nn[əe][\p{L}]*|kurs[\p{L}]*|bazar[ıi]|d[əe]yi[şs][\p{L}]*))?(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:dollar(?:[ıi]n)?|avro(?:nun)?|eur|usd|azn|rubl|lir[əe]|bitcoin|btc|eth|ethereum|q[ıi]z[ıi]l(?:[ıi]n)?|neft(?:in)?|brent|s[əe]hm(?:i|l[əe]ri)?|stock\s+price)\s+(?:kurs[\p{L}]*|m[əe]z[əe]nn[əe][\p{L}]*|qiym[əe]t[\p{L}]*|ne[cç][əe]y[əe]dir|n[əe]\s+q[əe]d[əe]rdir|price|rate)|(?<![\p{L}\p{N}])(?:m[əe]z[əe]nn[əe]si|valyuta\s+kurs[\p{L}]*|exchange\s+rate|live\s+price|current\s+price)(?![\p{L}\p{N}])|\b(?:usd|eur|gbp|try|rub)\s*(?:\/|to|-)\s*(?:azn|usd|eur|try)\b)|(?:(?:idman|futbol|basketbol|tennis|voleybol|g[üu]l[əe][şs]|boks|formula\s*1|ufc|nba|uefa|[çc]empionlar\s+liqas[ıi]|premyer\s+liqa|qaraba[gğ](?:\s+fk)?|oyun(?:un|lar[ıi]n)?|mat[çc](?:[ıi]n)?|qar[şs][ıi]la[şs]ma(?:n[ıi]n)?|liqa(?:n[ıi]n)?|[çc]empionat(?:[ıi]n)?|turnir(?:in)?)\s+(?:n[əe]tic[əe][\p{L}]*|hesab[ıi]?|c[əe]dv[əe]l[\p{L}]*|xal[\p{L}]*|score|standings|results?|qalib[\p{L}]*|kim\s+uddu|ne[cç][əe]-ne[cç][əe])|(?<![\p{L}\p{N}])(?:idman\s+n[əe]tic[əe][\p{L}]*|canl[ıi]\s+hesab|live\s+score|match\s+result|final\s+score|who\s+won\s+(?:the\s+)?(?:match|game|cup|league|championship))(?![\p{L}\p{N}])))/iu;

const REALTIME_CONCEPTUAL_EXCLUSION_PATTERN =
  /(?:(?:valyuta|m[əe]z[əe]nn[əe]|qiym[əe]t|hava)\s+(?:n[əe]\s+dem[əe]kdir|nec[əe]\s+hesablan[ıi]r|strategiyas[ıi]|psixologiyas[ıi]|siyas[əe]ti))/iu;

const DIRECT_FAST_PATH_BLOCKER_PATTERN =
  /(?:https?:\/\/|www\.|\b[a-zA-Z0-9-]+\.(?:az|com|org|net|io|co|ai|edu|gov|tr|ru|tech|biz|info|me|app)\b|<\/?untrusted_data>|(?<![\p{L}\p{N}])(?:202\d|203\d|bu\s+il|bu\s+ay|bu\s+g[üu]n|bug[üu]n[\p{L}]*|haz[ıi]rda|haz[ıi]rk[ıi]|hal-?haz[ıi]r[\p{L}]*|son\s+[\p{L}]+|yeni\s+[\p{L}]+|cari|aktual|x[əe]b[əe]r[\p{L}]*|news|today|latest|current|recent|hava[\p{L}]*|weather|qiym[əe]t[\p{L}]*|price|pricing|cost|tarif[\p{L}]*|m[əe]z[əe]nn[əe][\p{L}]*|valyuta|inflyasiya|inflasiya|m[əe]rk[əe]zi\s+bank|r[əe]qib[\p{L}]*|competitor[\p{L}]*|bazar\s+pay[ıi]|statistika|kurs[\p{L}]*|s[əe]hm[\p{L}]*|neft|q[ıi]z[ıi]l|bitcoin|btc|eth|google|internet|veb|web|m[əe]nb[əe][\p{L}]*|r[əe]smi|d[əe]qiq|[əe]mins[əe]n|do[gğ]rudan|kimdir|prezident[\p{L}]*|nazir[\p{L}]*|ba[şs]\s+nazir|ceo|founder|t[əe]sis[çc]i|r[əe]hb[əe]r[\p{L}]*|direktor[\p{L}]*|who\s+is|harada\s+yerl[əe][şs]ir|[üu]nvan[ıi]?|[əe]laq[əe]\s+n[öo]mr[əe]|hans[ıi]\s+(?:[şs]irk[əe]t|brend|ma[gğ]aza|agentlik)|burax[ıi]l[ıi][şs]|reliz[\p{L}]*|release[\p{L}]*|benchmark[\p{L}]*|versiya[\p{L}]*|unsafe|yenid[əe]n\s+yoxla|internetd[əe]\s+yoxla|vebd[əe]\s+yoxla)(?![\p{L}\p{N}]))/iu;

const DIRECT_OFFLINE_TASK_PATTERN =
  /(?:\b(?:python|javascript|typescript|java|c\+\+|c#|golang|rust|ruby|php|swift|kotlin|sql|html|css|bash|zsh|react|node\.?js|express|regex|dockerfile|yaml|json|sql\s+query|function|class|async|await|promise|hook|component)\b.*(?:\byaz\b|\bhaz[ıi]rla\b|\bver\b|\bd[üu]z[əe]lt\b|\bdebug\b|\bfix\b|\bwrite\b|\bcreate\b|\brefactor\b|\boptimize\b|\bexplain\b|\bizah\b|\bn[əe]dir\b|\bnec[əe]\b|\bx[əe]ta|\berror\b|\bbug\b|\bsort\b|\bsearch\b|\balqoritm)|(?:kod(?:u|da|unu)?|skript|funksiya(?:n[ıi])?|proqram|alqoritm(?:ini|i)?|sor[gğ]u)\s+(?:yaz|haz[ıi]rla|d[üu]z[əe]lt|optimalla[şs]d[ıi]r|refaktor\s+et|yoxla\s+v[əe]\s+d[üu]z[əe]lt|izah\s+et)|(?:x[əe]tan[ıi]|x[əe]tas[ıi]n[ıi]|bug(?:-ı)?|error(?:-u)?)\s+(?:d[üu]z[əe]lt|h[əe]ll\s+et|tap\s+v[əe]\s+d[üu]z[əe]lt|izah\s+et)|\b(?:debug|fix\s+(?:this|the)\s+(?:code|bug|error|function)|write\s+a\s+(?:function|script|query|regex|class|test)|refactor\s+this)\b|t[əe]rc[üu]m[əe]\s+et|\btranslate\b(?:\s+(?:this|to|into|from))?|(?:ingilisc[əe](?:y[əe])?|az[əe]rbaycanca(?:ya)?|rusca(?:ya)?|t[üu]rkc[əe](?:y[əe])?)\s+[çc]evir|m[əe]tni(?:mi)?\s+(?:redakt[əe]\s+et|d[üu]z[əe]lt|q[ıi]salt|yenid[əe]n\s+yaz|parafraz\s+et|t[əe]kmill[əe][şs]dir|sad[əe]l[əe][şs]dir|x[üu]las[əe]\s+et|yoxla)|redakt[əe]\s+et|parafraz\s+et|qrammatik\s+s[əe]hvl[əe]ri\s+d[üu]z[əe]lt|\b(?:rewrite|paraphrase|proofread|summarize\s+this\s+text|edit\s+this\s+text|shorten\s+this\s+text|polish\s+this\s+email)\b|^\s*[-+(]?\d[\d\s.,]*(?:[+\-*/^%×÷]\s*[-+(]?\d[\d\s.,]*)+\s*(?:=|ne[çc][əe](?:\s+edir)?|hesabla)?\s*\??\s*$|t[əe]nliyi(?:ni)?\s+h[əe]ll\s+et|t[öo]r[əe]m[əe](?:sini)?\s+(?:tap|hesabla)|inteqral(?:[ıi]n[ıi])?\s+hesabla|faizini\s+hesabla|\b(?:solve\s+(?:for|the\s+equation)|calculate|compute|derivative\s+of|integral\s+of)\b|ideya(?:lar[ıi]?)?\s+(?:ver|yaz|haz[ıi]rla|t[əe]klif\s+et|tap)|(?:brend|şirk[əe]t|layih[əe]|məhsul|startup|kafe|ma[gğ]aza)\s+ad[ıi]?\s+(?:ideya|t[əe]klif|tap|ver)|(?:slogan|ş[üu]ar|başl[ıi]q|hekay[əe]|şeir|post\s+m[əe]tni|reklam\s+m[əe]tni|e-?mail\s+şablonu|m[əe]ktub)\s+(?:yaz|haz[ıi]rla|ver|yarat)|\b(?:brainstorm|give\s+me\s+(?:\d+\s+)?ideas?|write\s+a\s+(?:short\s+)?(?:slogan|poem|story|email|tagline|bio|caption))\b|n[əe]\s+dem[əe]kdir\??|nec[əe]\s+i[şs]l[əe]yir\??|nec[əe]\s+hesablan[ıi]r\??|d[üu]sturu\s+n[əe]dir\??|f[əe]rqi\s+n[əe]dir\??|prinsipl[əe]ri\s+hans[ıi]lard[ıi]r\??|sad[əe]\s+dild[əe]\s+izah\s+et|\b(?:what\s+does\s+.+\s+mean|how\s+does\s+.+\s+work|what\s+is\s+the\s+difference\s+between|explain\s+(?:what|how|the\s+concept|in\s+simple\s+terms))\b)/iu;

export const GROUNDED_VERIFICATION_FOLLOWUP_PATTERN =
  /^\s*(?:d[əe]qiq\??|[əe]mins[əe]n\??|do[gğ]rudan\??|h[əe]qiq[əe]t[əe]n\??|d[uü]zd[uü]r\??|yenid[əe]n\s+c[əe]hd\s+et|t[əe]krar\s+(?:c[əe]hd\s+et|yoxla|axtar|ara[sş]d[ıi]r)|bir\s+d[əe]\s+(?:yoxla|bax|ara[sş]d[ıi]r)|olmayacaq\??|yoxla|exact(?:ly)?\??|really\??|are\s+you\s+sure\??|sure\??|verify\??|retry|try\s+again|check\s+again|m[əe]nb[əe]\??|sources?\??|link\??)\s*[!?.…\s]*$/i;

const CONVERSATIONAL_GREETING_FAST_PATH_PATTERN =
  /^\s*(?:salam(?:lar|aleykum|əleykum)?|sabah[ıi]n(?:[ıi]z)?\s+xeyir|ax[şs]am[ıi]n(?:[ıi]z)?\s+xeyir|g[üu]nortan(?:[ıi]z)?\s+xeyir|nec[əe]s[əe]n|nec[əe]siz|h[əe]r\s+vaxt[ıi]n(?:[ıi]z)?\s+xeyir|t[əe][şs][əe]kk[üu]r(?:l[əe]r)?|sa[ğg]\s+ol(?:un)?|[çc]ox\s+sa[ğg]\s+ol(?:un)?|oldu|yax[şs][ıi]|super|əla|əlad[ıi]r?|tamam|ba[şs]a\s+d[üu][şs]d[üu]m|hi+|hello+|hey+|good\s+(?:morning|afternoon|evening)|thanks?(?:\s+you)?|ok(?:ay)?|got\s+it|привет|здравствуй(?:те)?|спасибо)\s*[!?.😊👍🙏]*\s*$/i;

export function classifyAskFastPath({
  lastUserMsg = "",
  messages = [],
  explicitWeb = false,
  hasStrategyContext = false,
  groundedHistory = false,
  hasMedia = false,
} = {}) {
  const msg = String(lastUserMsg || "").trim();
  const isAssistantIdentityQuery = ASSISTANT_IDENTITY_GUARD_PATTERN.test(msg);

  const hasExplicitWebCommand =
    explicitWeb === true ||
    URL_OR_DOMAIN_PATTERN.test(msg) ||
    (EXPLICIT_SEARCH_DIRECTIVE_PATTERN.test(msg) && !NON_WEB_SEARCH_FALSE_POSITIVE_PATTERN.test(msg));

  const hasAiModelReleaseQuery =
    !isAssistantIdentityQuery &&
    (AI_STANDALONE_LIVE_PATTERN.test(msg) ||
      (AI_MODEL_ENTITY_PATTERN.test(msg) && AI_MODEL_LIVE_QUALIFIER_PATTERN.test(msg)));

  const hasRealtimeFastSignal =
    !hasStrategyContext &&
    !isAssistantIdentityQuery &&
    LIVE_REALTIME_FAST_PATH_PATTERN.test(msg) &&
    !REALTIME_CONCEPTUAL_EXCLUSION_PATTERN.test(msg);

  if (hasExplicitWebCommand || hasAiModelReleaseQuery || hasRealtimeFastSignal) {
    const localEval = evaluateSearchRoute({
      prompt: msg,
      messages,
      hasStrategyContext,
      hasGroundedHistory: groundedHistory,
    });
    return {
      enableSearch: true,
      requireGrounding: Boolean(explicitWeb || localEval.requireGrounding),
      intent: "grounded_search",
      prompt: msg,
      routerSource: "fast_path",
      decisionPath: "fast_path_search",
      confidence: 1,
      latencyMs: 0,
    };
  }

  if (!explicitWeb && !groundedHistory && !hasMedia && msg.length > 0) {
    const isGreeting = msg.length <= 60 && CONVERSATIONAL_GREETING_FAST_PATH_PATTERN.test(msg);
    const isDirectOfflineTask =
      !DIRECT_FAST_PATH_BLOCKER_PATTERN.test(msg) &&
      !AI_MODEL_ENTITY_PATTERN.test(msg) &&
      !AI_STANDALONE_LIVE_PATTERN.test(msg) &&
      DIRECT_OFFLINE_TASK_PATTERN.test(msg);

    if (isGreeting || isAssistantIdentityQuery || isDirectOfflineTask) {
      return {
        enableSearch: false,
        requireGrounding: false,
        intent: isGreeting || isAssistantIdentityQuery ? "direct_chat" : "standard",
        prompt: msg,
        routerSource: "fast_path",
        decisionPath: "fast_path_direct",
        confidence: 0.99,
        latencyMs: 0,
      };
    }
  }

  return null;
}
