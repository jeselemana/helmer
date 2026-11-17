import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPersonalizationContext,
  buildStrategyPersonalizationContext,
  getRelevantUserContext,
  invalidateUserContextCache,
  tokens,
  relevance,
  TONE_DIRECTIVES,
} from "../src/services/ai/personal-context.js";
import {
  UserSettingsSchema,
  AddMemoryItemSchema,
  ImportedMemoryItemSchema,
  ImportMemoryPayloadSchema,
  detectSensitiveInformation,
} from "../src/auth/validation.js";

function repository(records) {
  return { readAll: async () => records };
}

test("personal context returns only relevant, owner-scoped saved context", async () => {
  const chatRepository = repository([
    {
      id: "chat-owner",
      ownerId: "user-a",
      title: "Instagram planı",
      updatedAt: "2026-08-10T00:00:00.000Z",
      messages: [{ role: "user", content: "Instagram reklamlarında əsas məqsədimiz e-ticarət ROAS göstəricisini artırmaqdır." }],
    },
    {
      id: "chat-other-user",
      ownerId: "user-b",
      title: "Gizli plan",
      updatedAt: "2026-08-11T00:00:00.000Z",
      messages: [{ role: "user", content: "Instagram reklam büdcəmiz tam məxfidir." }],
    },
    {
      id: "current-chat",
      ownerId: "user-a",
      title: "Cari söhbət",
      messages: [{ role: "user", content: "Instagram üçün cari sual təkrarı." }],
    },
  ]);
  const strategyRepository = repository([
    { ownerId: "user-a", title: "SEO strategiyası", brief: "Orqanik axtarış trafiki", updatedAt: "2026-08-09T00:00:00.000Z" },
    { ownerId: "user-b", title: "Instagram sirri", brief: "Başqa istifadəçinin məlumatı" },
  ]);

  const context = await getRelevantUserContext({
    ownerId: "user-a",
    userMessage: "Instagram reklam ROAS nəticəsini necə yaxşılaşdıraq?",
    currentChatId: "current-chat",
    chatRepository,
    strategyRepository,
  });

  assert.match(context, /e-ticarət ROAS/);
  assert.doesNotMatch(context, /tam məxfidir|Başqa istifadəçinin|cari sual təkrarı/);
  assert.doesNotMatch(context, /SEO strategiyası/);
});

test("personal context stays empty when saved data is unrelated", async () => {
  const context = await getRelevantUserContext({
    ownerId: "user-a",
    userMessage: "Instagram reklamları",
    chatRepository: repository([{ ownerId: "user-a", messages: [{ role: "user", content: "Komanda işə qəbulu" }] }]),
    strategyRepository: repository([]),
  });
  assert.equal(context, "");
});

test("personal context matches Azerbaijani name suffixes across chats", async () => {
  const context = await getRelevantUserContext({
    ownerId: "user-a",
    userMessage: "Adımı bilirsən?",
    chatRepository: repository([{
      id: "old-chat",
      ownerId: "user-a",
      title: "Tanışlıq",
      messages: [{ role: "user", content: "Mənim adım Cesurdur." }],
    }]),
    strategyRepository: repository([]),
    userProfile: { fullName: "Hesab Adı" },
  });

  assert.match(context, /Mənim adım Cesurdur/);
  assert.doesNotMatch(context, /Hesab Adı/);
});

test("name questions use the authenticated profile only as a relevant fallback", async () => {
  const repositories = {
    chatRepository: repository([]),
    strategyRepository: repository([]),
  };
  const nameContext = await getRelevantUserContext({
    ownerId: "user-a",
    userMessage: "Adımı bilirsən?",
    userProfile: { fullName: "Cesur Elemana" },
    ...repositories,
  });
  const unrelatedContext = await getRelevantUserContext({
    ownerId: "user-a",
    userMessage: "Instagram reklamlarını necə yaxşılaşdıraq?",
    userProfile: { fullName: "Cesur Elemana" },
    ...repositories,
  });

  assert.match(nameContext, /Cesur Elemana/);
  assert.equal(unrelatedContext, "");
});

test("Azerbaijani stemmer and token matcher correctly links inflected words", () => {
  const queryTokens = tokens("mağazamıza");
  const text = "Yeni mağaza açılışı və marketinq tədbirləri";
  const score = relevance(queryTokens, text);
  assert.ok(score > 0, "Stemmer should link 'mağazamıza' and 'mağaza'");
});

test("buildPersonalizationContext compiles full brand profile, tone directives, custom instructions, and memories", async () => {
  const user = {
    id: "usr-123",
    fullName: "Cesur Elemana",
    settings: {
      personalIntelligence: true,
      brandName: "Helmer",
      industry: "B2B SaaS & Marketing",
      primaryMarket: "Azərbaycan və Qlobal",
      targetAudience: "Startaplar, agentliklər və biznes sahibləri",
      tone: "concise",
      customInstructions: "Həmişə büdcəyə qənaət edən kanalları tövsiyə et və cavabı addım-addım qur.",
      memories: [
        { id: "mem-1", text: "Biz yalnız B2B şirkətlərlə işləyirik.", category: "business", createdAt: "2026-08-15T00:00:00Z" },
        { id: "mem-2", text: "Ənənəvi TV/Radio reklamları istifadə etmirik.", category: "constraint", createdAt: "2026-08-15T00:00:00Z" },
      ],
      modelImprovement: true,
      autoContext: true,
      strategyPersonalization: true,
    },
  };

  const chatRepo = repository([
    {
      id: "c-1",
      ownerId: "usr-123",
      title: "SaaS Böyümə",
      messages: [{ role: "user", content: "SaaS müştəri cəlb etmə xərclərini (CAC) necə optimallaşdıraq?" }],
    },
  ]);

  const context = await buildPersonalizationContext({
    user,
    userMessage: "CAC göstəricisini azaltmaq üçün hansı addımları ataq?",
    chatRepository: chatRepo,
    strategyRepository: repository([]),
    mode: "ask",
  });

  assert.match(context, /<user_personalization_context>/);
  assert.match(context, /Helmer/);
  assert.match(context, /B2B SaaS & Marketing/);
  assert.match(context, /Azərbaycan və Qlobal/);
  assert.match(context, /Qısa və İcra Yönümlü/);
  assert.match(context, /Həmişə büdcəyə qənaət edən kanalları/);
  assert.match(context, /Biz yalnız B2B şirkətlərlə işləyirik/);
  assert.match(context, /Məhdudiyyət \/ Qadağa/);
  assert.match(context, /Ənənəvi TV\/Radio reklamları/);
  assert.match(context, /SaaS müştəri cəlb etmə/);
});

test("buildPersonalizationContext returns empty if personalIntelligence is disabled", async () => {
  const user = {
    id: "usr-disabled",
    fullName: "Test User",
    settings: {
      personalIntelligence: false,
      brandName: "Gizli Brend",
    },
  };

  const context = await buildPersonalizationContext({
    user,
    userMessage: "Sual",
  });
  assert.equal(context, "");
});

test("buildPersonalizationContext respects strategyPersonalization flag for strategy mode", async () => {
  const user = {
    id: "usr-strat-off",
    fullName: "Strategy Off",
    settings: {
      personalIntelligence: true,
      strategyPersonalization: false,
      brandName: "Brand Off",
    },
  };

  const stratContext = await buildPersonalizationContext({
    user,
    userMessage: "Strategiya brifi",
    mode: "strategy",
  });
  assert.equal(stratContext, "");

  const askContext = await buildPersonalizationContext({
    user,
    userMessage: "Strategiya brifi",
    mode: "ask",
  });
  assert.match(askContext, /Brand Off/);
});

test("buildStrategyPersonalizationContext includes only minimal settings profile", () => {
  const context = buildStrategyPersonalizationContext({
    user: {
      id: "usr-build",
      fullName: "Build User",
      settings: {
        personalIntelligence: true,
        strategyPersonalization: true,
        brandName: "Helmer",
        industry: "B2B SaaS",
        primaryMarket: "Azərbaycan",
        targetAudience: "Kiçik bizneslər",
        tone: "concise",
        customInstructions: "Hər cavabda uzun bir araşdırma əlavə et.",
        memories: [{ id: "m1", text: "Keçmiş yaddaş qeydi", category: "general", createdAt: "2026-08-20" }],
        modelImprovement: true,
        autoContext: true,
      },
    },
  });

  assert.match(context, /<build_profile>/);
  assert.match(context, /Helmer/);
  assert.match(context, /B2B SaaS/);
  assert.match(context, /Azərbaycan/);
  assert.match(context, /Kiçik bizneslər/);
  assert.match(context, /Qısa və icra yönümlü/);
  assert.doesNotMatch(context, /Build User/);
  assert.doesNotMatch(context, /uzun bir araşdırma/);
  assert.doesNotMatch(context, /Keçmiş yaddaş qeydi/);
  assert.doesNotMatch(context, /user_personalization_context/);
});

test("buildStrategyPersonalizationContext respects Build personalization settings", () => {
  assert.equal(buildStrategyPersonalizationContext({
    user: { settings: { personalIntelligence: false, brandName: "Hidden" } },
  }), "");
  assert.equal(buildStrategyPersonalizationContext({
    user: { settings: { personalIntelligence: true, strategyPersonalization: false, brandName: "Hidden" } },
  }), "");
});

test("UserSettingsSchema and AddMemoryItemSchema validation works correctly", () => {
  const validSettings = UserSettingsSchema.parse({
    personalIntelligence: true,
    brandName: "Test Co",
    tone: "creative",
    defaultMode: "ask",
    memories: [{ id: "m1", text: "Biz yalnız B2B şirkətlərlə işləyirik.", category: "preference", createdAt: "2026-08-20" }],
  });
  assert.equal(validSettings.brandName, "Test Co");
  assert.equal(validSettings.tone, "creative");
  assert.equal(validSettings.defaultMode, "ask");
  assert.equal(validSettings.memories.length, 1);

  const defaultModeDefault = UserSettingsSchema.parse({});
  assert.equal(defaultModeDefault.defaultMode, undefined, "PATCH must preserve omitted settings");

  const memory = AddMemoryItemSchema.parse({ text: "Biz yalnız B2B şirkətlərlə işləyirik.", category: "business" });
  assert.equal(memory.text, "Biz yalnız B2B şirkətlərlə işləyirik.");
  assert.equal(memory.category, "business");
});

test("detectSensitiveInformation catches phone numbers, residential addresses, payment cards, IDs, and passwords", () => {
  // 1. Phone numbers
  assert.equal(detectSensitiveInformation("+994 50 123 45 67").isSensitive, true);
  assert.equal(detectSensitiveInformation("Əlaqə nömrəmiz: 055-987-65-43").isSensitive, true);
  assert.equal(detectSensitiveInformation("Telefon: +1 555-432-1234").isSensitive, true);

  // 2. Residential addresses
  assert.equal(detectSensitiveInformation("Ev ünvanım: Nizami küçəsi 45, mənzil 12").isSensitive, true);
  assert.equal(detectSensitiveInformation("Yaşayış ünvanı: Nəsimi rayonu, Azadlıq pr. 104, bina 3, mənzil 28").isSensitive, true);
  assert.equal(detectSensitiveInformation("Mənim evim: Həsən Əliyev küç. ev 15, mənzil 4").isSensitive, true);

  // 3. Payment cards
  assert.equal(detectSensitiveInformation("Kart nömrəm 4169 7388 1234 5678").isSensitive, true);
  assert.equal(detectSensitiveInformation("CVV kodum: 789").isSensitive, true);
  assert.equal(detectSensitiveInformation("IBAN: AZ21NABZ01350100000000001234").isSensitive, true);

  // 4. Identification & FIN
  assert.equal(detectSensitiveInformation("FIN kodum: 6ABCD12").isSensitive, true);
  assert.equal(detectSensitiveInformation("Şəxsiyyət vəsiqəsi: AZE 12345678").isSensitive, true);

  // 5. Passwords & API keys
  assert.equal(detectSensitiveInformation("Şifrəm: MySecretPass123!").isSensitive, true);
  assert.equal(detectSensitiveInformation("API key: sk-live-998877665544332211").isSensitive, true);

  // 6. Safe non-sensitive business facts
  assert.equal(detectSensitiveInformation("Biz yalnız B2B şirkətlərlə işləyirik.").isSensitive, false);
  assert.equal(detectSensitiveInformation("Hədəf kütləmiz 20-35 yaş arası gənclərdir.").isSensitive, false);
  assert.equal(detectSensitiveInformation("Büdcəmiz aylıq 5000 AZN təşkil edir.").isSensitive, false);
  assert.equal(detectSensitiveInformation("Azərbaycan və Türkiyə bazarlarında fəaliyyət göstəririk.").isSensitive, false);
});

test("AddMemoryItemSchema and UserSettingsSchema reject sensitive personal info", () => {
  assert.throws(
    () => AddMemoryItemSchema.parse({ text: "Mənim nömrəm 050-123-45-67" }),
    (err) => err.issues[0].message.includes("telefon"),
  );

  assert.throws(
    () => AddMemoryItemSchema.parse({ text: "Yaşayış ünvanı: Nərimanov r., Təbriz küç. ev 5, mənzil 20" }),
    (err) => err.issues[0].message.includes("yaşayış"),
  );

  assert.throws(
    () => UserSettingsSchema.parse({
      memories: [{ id: "m1", text: "Şifrə: AdminPass2026!", category: "general", createdAt: "2026-08-20" }],
    }),
    (err) => err.issues[0].message.includes("şifrə"),
  );
});

test("ImportMemoryPayloadSchema validates correctly with merge and replace modes", () => {
  const payload = ImportMemoryPayloadSchema.parse({
    brandName: "Helmer",
    industry: "B2B SaaS",
    primaryMarket: "Azərbaycan",
    targetAudience: "Startaplar",
    tone: "creative",
    customInstructions: "Həmişə ROI göstəricisini vurğula.",
    memories: [
      { text: "Biz yalnız B2B şirkətlərlə işləyirik.", category: "business" },
      { text: "TV və radio reklamları etmirik.", category: "constraint" },
    ],
    mergeMode: "merge",
    enablePersonalIntelligence: true,
  });

  assert.equal(payload.brandName, "Helmer");
  assert.equal(payload.industry, "B2B SaaS");
  assert.equal(payload.tone, "creative");
  assert.equal(payload.memories.length, 2);
  assert.equal(payload.mergeMode, "merge");
  assert.equal(payload.enablePersonalIntelligence, true);
});

test("ImportedMemoryItemSchema rejects sensitive personal info during import", () => {
  assert.throws(
    () => ImportedMemoryItemSchema.parse({ text: "Əlaqə nömrəsi: +994 50 123 45 67" }),
    (err) => err.issues[0].message.includes("telefon"),
  );

  assert.throws(
    () => ImportMemoryPayloadSchema.parse({
      brandName: "Test Brand",
      memories: [{ text: "Kart nömrəsi 4169 7388 1234 5678", category: "business" }],
    }),
    (err) => err.issues[0].message.includes("bank kartı"),
  );
});

test("cached getRelevantUserContext revalidates only matched top candidates instead of all cached records", async (t) => {
  const ownerId = "owner-cache-readall-1";
  t.after(() => invalidateUserContextCache(ownerId));
  let readAllChats = 0;
  let getByIdChats = 0;
  let records = Array.from({ length: 12 }, (_, idx) => ({
    id: `c-${idx}`,
    ownerId,
    title: `Kafe ${idx}`,
    updatedAt: `2026-10-${String(10 + idx).padStart(2, "0")}`,
    messages: [{ role: "user", content: `Kafe açılış büdcəsi planı ${idx}` }],
  }));
  const chatRepo = {
    readAll: async () => {
      readAllChats++;
      return structuredClone(records);
    },
    getById: async (id) => {
      getByIdChats++;
      return structuredClone(records.find((r) => r.id === id) || null);
    },
  };
  const strategyRepo = {
    readAll: async () => [],
    getById: async () => null,
  };

  const first = await getRelevantUserContext({
    ownerId,
    userMessage: "Kafe açılış büdcəsi",
    chatRepository: chatRepo,
    strategyRepository: strategyRepo,
    maxItems: 2,
  });
  assert.match(first, /Kafe açılış büdcəsi/);

  const second = await getRelevantUserContext({
    ownerId,
    userMessage: "Kafe açılış büdcəsi",
    chatRepository: chatRepo,
    strategyRepository: strategyRepo,
    maxItems: 2,
  });
  assert.match(second, /Kafe açılış büdcəsi/);
  assert.equal(readAllChats, 1);
  assert.equal(getByIdChats, 2);

  // Unrelated message matches 0 records -> 0 getById calls even on warm cache
  const unrelated = await getRelevantUserContext({
    ownerId,
    userMessage: "tamamilə fərqli mövzu",
    chatRepository: chatRepo,
    strategyRepository: strategyRepo,
    maxItems: 2,
  });
  assert.equal(unrelated, "");
  assert.equal(getByIdChats, 2);

  records = [];
  const third = await getRelevantUserContext({
    ownerId,
    userMessage: "Kafe açılış büdcəsi",
    chatRepository: chatRepo,
    strategyRepository: strategyRepo,
    maxItems: 2,
  });
  assert.equal(third, "");
  assert.equal(readAllChats, 1);
});


test("automatic chat retrieval requires both personalization and model improvement", async () => {
  let reads = 0;
  const chatRepository = {
    readAll: async () => {
      reads++;
      return [{ id: "previous", ownerId: "owner", title: "Budget", messages: [{ role: "user", content: "Quarterly budget forecast" }] }];
    },
  };
  const settings = { personalIntelligence: true, autoContext: true, modelImprovement: false };
  const context = () => buildPersonalizationContext({
    user: { id: "owner", settings }, userMessage: "Quarterly budget forecast", chatRepository,
  });
  assert.doesNotMatch(await context(), /Quarterly budget forecast/);
  assert.equal(reads, 0);
  settings.modelImprovement = true;
  assert.match(await context(), /Quarterly budget forecast/);
  assert.equal(reads, 1);
});
